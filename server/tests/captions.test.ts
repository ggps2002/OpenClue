import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { ClaudeClient } from '../src/lib/claude';
import { FfmpegService } from '../src/lib/ffmpeg';
import { prisma } from '../src/lib/prisma';
import { SpeechClient } from '../src/lib/speech';
import { StorageService } from '../src/lib/storage';
import { CaptionService } from '../src/modules/captions/captions.service';
import { MediaService } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import type { ScriptSegment } from '../src/modules/scripts/scripts.schema';
import { ScriptService } from '../src/modules/scripts/scripts.service';
import type { TimelineDoc } from '../src/modules/timelines/timelines.schema';
import { TranscriptService } from '../src/modules/transcripts/transcripts.service';
import { VoiceoverService } from '../src/modules/voiceovers/voiceovers.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();
const storage = new StorageService();
const ffmpeg = new FfmpegService();
const media = new MediaService(storage);
const projects = new ProjectService(storage);
const scripts = new ScriptService(projects, media, new TranscriptService(media, storage, ffmpeg, new SpeechClient(undefined)), new ClaudeClient(undefined));

/** Stands in for OpenAI TTS: 300 ms of tone per word, so speech ends well before most segment slots do. */
class FakeSpeech extends SpeechClient {
  constructor() {
    super(undefined);
  }
  override get isOnline(): boolean {
    return true;
  }
  override async synthesize(text: string, _voice: string, outputPath: string): Promise<void> {
    const seconds = (text.split(/\s+/).length * 0.3).toFixed(2);
    await ffmpeg.exec(['-y', '-f', 'lavfi', '-i', `sine=duration=${seconds}`, '-ac', '1', '-ar', '24000', outputPath]);
  }
}
const voiceovers = new VoiceoverService(scripts, storage, ffmpeg, new FakeSpeech());
const service = new CaptionService(projects, scripts, voiceovers);
afterAll(() => fs.rmSync(env.storageDir, { recursive: true, force: true }));

const SEGMENTS: ScriptSegment[] = [
  { id: 'a', startMs: 0, endMs: 3000, text: 'Welcome to the tour of our new dashboard. Let us begin.' },
  { id: 'b', startMs: 3000, endMs: 4000, text: '' },
  { id: 'c', startMs: 4000, endMs: 8000, text: 'Open the settings page.' },
];

describe('CaptionService', () => {
  let owner: TestUser;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Product Tour: v2')).id;
    await prisma.script.create({ data: { projectId, source: 'offline', segments: SEGMENTS } });
  });

  it('builds cues from the script slots when there is no voiceover', async () => {
    expect(await service.get(owner.id, projectId)).toEqual({ role: 'owner', captions: null });
    const captions = await service.generate(owner.id, projectId, {});
    expect(captions).toMatchObject({ timing: 'script', stale: false, maxCharsPerLine: 42, maxLines: 2, language: 'en' });
    expect(captions.style.preset).toBe('clean');
    expect(captions.cues.map(({ startMs, endMs, text }) => [startMs, endMs, text])).toEqual([
      [0, 2278, 'Welcome to the tour of our new dashboard.'],
      [2278, 3000, 'Let us begin.'],
      [4000, 8000, 'Open the settings page.'],
    ]);
    expect((await service.get(owner.id, projectId)).captions).toEqual(captions);
  });

  it('ends each caption with its spoken clip and flags captions the script has outgrown', async () => {
    await voiceovers.generate(owner.id, projectId, { voice: 'nova', scope: 'changed' });
    const captions = await service.generate(owner.id, projectId, { maxCharsPerLine: 30, maxLines: 1, preset: 'bold' });
    expect(captions.timing).toBe('voiceover');
    expect(captions.style).toMatchObject({ preset: 'bold', uppercase: true });
    const last = captions.cues.at(-1)!;
    // Four words of fake speech are 1.2 s (plus a little MP3 padding), inside the 4 s slot.
    expect(last.startMs).toBe(4000);
    expect(last.endMs).toBeGreaterThanOrEqual(5200);
    expect(last.endMs).toBeLessThan(5400);
    expect(captions.cues.every((c) => !c.text.includes('\n') && c.text.length <= 30)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await scripts.update(owner.id, projectId, [{ ...SEGMENTS[0], text: 'Hello.' }, SEGMENTS[2]]);
    expect((await service.get(owner.id, projectId)).captions?.stale).toBe(true);

    // Regenerating keeps the chosen style and layout.
    const again = await service.generate(owner.id, projectId, {});
    expect(again).toMatchObject({ stale: false, maxCharsPerLine: 30, maxLines: 1, style: { preset: 'bold' } });
    expect(again.cues[0].text).toBe('Hello.');
  });

  it('saves edited cues and style, and rejects scripts without text', async () => {
    const captions = await service.generate(owner.id, projectId, {});
    const cues = [{ ...captions.cues[0], text: 'Edited' }];
    const style = { ...captions.style, textColor: '#ff0000', position: 'top' as const };
    const saved = await service.update(owner.id, projectId, { cues, style });
    expect(saved.cues).toEqual(cues);
    expect(saved.style).toEqual(style);
    expect(saved.stale).toBe(false);

    await scripts.update(owner.id, projectId, [{ id: 'a', startMs: 0, endMs: 1000, text: '' }]);
    await expect(service.generate(owner.id, projectId, {})).rejects.toMatchObject({ status: 422 });
  });

  it('exports SRT and VTT, following the edit when there is one', async () => {
    await service.generate(owner.id, projectId, {});
    const srt = await service.export(owner.id, projectId, { format: 'srt', timing: 'auto' });
    expect(srt.filename).toBe('product-tour-v2.en.srt');
    expect(srt.body.startsWith('1\n00:00:00,000 --> 00:00:02,278\nWelcome to the tour of our new dashboard.\n')).toBe(true);
    await expect(service.export(owner.id, projectId, { format: 'vtt', timing: 'timeline' })).rejects.toMatchObject({ status: 422 });

    const doc: TimelineDoc = {
      version: 1,
      scenes: [{ id: 's1', name: 'Scene 1', mediaId: 'video', inMs: 0, outMs: 8000, muted: true }],
      tracks: [{ id: 't', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c', source: { type: 'voiceover' }, startMs: 1000, inMs: 0, outMs: 8000 }] }],
    };
    await prisma.timeline.create({ data: { projectId, data: doc } });
    const vtt = await service.export(owner.id, projectId, { format: 'vtt', timing: 'auto' });
    expect(vtt.body.startsWith('WEBVTT\n\n00:00:01.000 --> 00:00:03.278\n')).toBe(true);
    const original = await service.export(owner.id, projectId, { format: 'vtt', timing: 'script' });
    expect(original.body).toContain('00:00:00.000 --> 00:00:02.278');
  });

  it('serves the routes with access checks', async () => {
    const base = `/api/projects/${projectId}/captions`;
    const presets = await request(app).get('/api/caption-presets').set('Cookie', owner.cookie).expect(200);
    expect(presets.body.presets.map((p: { id: string }) => p.id)).toContain('clean');

    await request(app).put(base).set('Cookie', owner.cookie).send({ cues: [] }).expect(404);
    await request(app).post(base).set('Cookie', owner.cookie).send({ preset: 'nope' }).expect(400);
    const generated = await request(app).post(base).set('Cookie', owner.cookie).send({}).expect(200);
    const cues = generated.body.captions.cues as { id: string; startMs: number; endMs: number; text: string }[];
    await request(app).put(base).set('Cookie', owner.cookie).send({ cues: [cues[1], cues[0]] }).expect(400);
    await request(app).put(base).set('Cookie', owner.cookie).send({ cues: [{ ...cues[0], text: '  ' }] }).expect(400);

    const file = await request(app).get(`${base}/export?format=srt`).set('Cookie', owner.cookie).expect(200);
    expect(file.headers['content-type']).toContain('application/x-subrip');
    expect(file.headers['content-disposition']).toContain('product-tour-v2.en.srt');
    expect(file.text).toContain('Open the settings page.');
    await request(app).get(`${base}/export?format=doc`).set('Cookie', owner.cookie).expect(400);

    const viewer = await signUpUser(app, 'viewer@example.com');
    await prisma.membership.create({ data: { userId: viewer.id, workspaceId: owner.workspaceId, role: 'viewer' } });
    const read = await request(app).get(base).set('Cookie', viewer.cookie).expect(200);
    expect(read.body.role).toBe('viewer');
    await request(app).get(`${base}/export?format=vtt`).set('Cookie', viewer.cookie).expect(200);
    await request(app).post(base).set('Cookie', viewer.cookie).send({}).expect(403);
    const outsider = await signUpUser(app, 'outsider@example.com');
    await request(app).get(base).set('Cookie', outsider.cookie).expect(404);

    await request(app).delete(base).set('Cookie', owner.cookie).expect(204);
    expect((await request(app).get(base).set('Cookie', owner.cookie).expect(200)).body.captions).toBeNull();
  });
});
