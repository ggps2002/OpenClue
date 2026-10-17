import fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { ClaudeClient } from '../src/lib/claude';
import { FfmpegService } from '../src/lib/ffmpeg';
import { prisma } from '../src/lib/prisma';
import { SpeechClient, type VoiceId } from '../src/lib/speech';
import { StorageService } from '../src/lib/storage';
import { MediaService } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import type { ScriptSegment } from '../src/modules/scripts/scripts.schema';
import { ScriptService } from '../src/modules/scripts/scripts.service';
import { TranscriptService } from '../src/modules/transcripts/transcripts.service';
import { MAX_TEMPO, VoiceoverService } from '../src/modules/voiceovers/voiceovers.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();
const storage = new StorageService();
const ffmpeg = new FfmpegService();
const offlineSpeech = new SpeechClient(undefined);
const media = new MediaService(storage);
const projects = new ProjectService(storage);
const scripts = new ScriptService(projects, media, new TranscriptService(media, storage, ffmpeg, offlineSpeech), new ClaudeClient(undefined));
afterAll(() => fs.rmSync(env.storageDir, { recursive: true, force: true }));

/** Stands in for OpenAI TTS: "speaks" 400 ms of tone per word, or fails for text containing "FAIL". */
class FakeSpeech extends SpeechClient {
  calls: { text: string; voice: VoiceId }[] = [];
  constructor() {
    super(undefined);
  }
  override get isOnline(): boolean {
    return true;
  }
  override async synthesize(text: string, voice: VoiceId, outputPath: string): Promise<void> {
    this.calls.push({ text, voice });
    if (text.includes('FAIL')) throw new Error('TTS unavailable');
    const seconds = (text.split(/\s+/).length * 0.4).toFixed(2);
    await ffmpeg.exec(['-y', '-f', 'lavfi', '-i', `sine=duration=${seconds}`, '-ac', '1', '-ar', '24000', outputPath]);
  }
}

const SEGMENTS: ScriptSegment[] = [
  { id: 'a', startMs: 0, endMs: 2000, text: 'Welcome to the tour.' },
  { id: 'b', startMs: 2000, endMs: 3000, text: '' },
  { id: 'c', startMs: 3000, endMs: 5000, text: 'Open the settings page now.' },
];

async function seedScript(projectId: string, segments: ScriptSegment[] = SEGMENTS) {
  await prisma.script.create({ data: { projectId, source: 'offline', segments } });
}

async function clipKeys() {
  const clips = await prisma.voiceoverClip.findMany({ orderBy: { segmentId: 'asc' } });
  return Object.fromEntries(clips.map((c) => [c.segmentId, c.storageKey]));
}

describe('VoiceoverService', () => {
  let owner: TestUser;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
    await seedScript(projectId);
  });

  it('makes silent clips of each segment length offline and mixes a full track', async () => {
    const service = new VoiceoverService(scripts, storage, ffmpeg, offlineSpeech);
    expect(await service.get(owner.id, projectId)).toBeNull();

    const voiceover = await service.generate(owner.id, projectId, { voice: 'nova', scope: 'changed' });
    expect(voiceover).toMatchObject({ voice: 'nova', offline: true, trackDurationMs: 5000 });
    expect(voiceover.segments.map((s) => [s.segmentId, s.status, s.durationMs])).toEqual([
      ['a', 'ready', 2000],
      ['b', 'empty', null],
      ['c', 'ready', 2000],
    ]);
    const trackPath = await service.trackFile(owner.id, projectId);
    expect(Math.abs((await ffmpeg.probeDurationMs(trackPath))! - 5000)).toBeLessThan(100);
    const clipPath = await service.clipFile(owner.id, projectId, 'a');
    expect(Math.abs((await ffmpeg.probeDurationMs(clipPath))! - 2000)).toBeLessThan(100);
    expect(await service.get(owner.id, projectId)).toEqual(voiceover);
  });

  it('only re-voices changed segments and cleans up replaced files', async () => {
    const service = new VoiceoverService(scripts, storage, ffmpeg, offlineSpeech);
    await service.generate(owner.id, projectId, { voice: 'nova', scope: 'changed' });
    const before = await clipKeys();

    await scripts.update(owner.id, projectId, [
      { ...SEGMENTS[0], text: 'Hello and welcome.' },
      { ...SEGMENTS[2], startMs: 2500 },
    ]);
    const stale = (await service.get(owner.id, projectId))!;
    expect(stale.segments.map((s) => [s.segmentId, s.status])).toEqual([
      ['a', 'stale'],
      ['c', 'stale'],
    ]);

    const after = await service.generate(owner.id, projectId, { voice: 'nova', scope: 'changed' });
    expect(after.segments.every((s) => s.status === 'ready')).toBe(true);
    expect(after.segments[1].durationMs).toBe(2500);
    const keys = await clipKeys();
    expect(keys.a).not.toBe(before.a);
    expect(await storage.exists(before.a)).toBe(false);
    expect(await storage.exists(keys.a)).toBe(true);
  });

  it('fits long speech by speeding it up, reports overflow, and only moves clips that still fit', async () => {
    const speech = new FakeSpeech();
    const service = new VoiceoverService(scripts, storage, ffmpeg, speech);
    await scripts.update(owner.id, projectId, [
      { id: 'a', startMs: 0, endMs: 2000, text: 'Welcome to the tour.' }, // 1.6 s, fits
      { id: 'c', startMs: 3000, endMs: 4000, text: 'Open the settings page now.' }, // 2 s in a 1 s slot
    ]);
    const voiceover = await service.generate(owner.id, projectId, { voice: 'onyx', scope: 'changed' });
    const [fits, tooLong] = voiceover.segments;
    expect(fits).toMatchObject({ status: 'ready', tempo: 1, overflowMs: 0, source: 'openai' });
    expect(tooLong.tempo).toBe(MAX_TEMPO);
    // 2 s of speech at 1.25x is 1.6 s in a 1 s slot (MP3 encoding adds a few ms of padding).
    expect(tooLong.overflowMs).toBeGreaterThanOrEqual(600);
    expect(tooLong.overflowMs).toBeLessThan(700);
    expect(voiceover.offline).toBe(false);
    expect(voiceover.trackDurationMs).toBe(3000 + tooLong.durationMs!);
    expect(speech.calls).toEqual([
      { text: 'Welcome to the tour.', voice: 'onyx' },
      { text: 'Open the settings page now.', voice: 'onyx' },
    ]);

    // Moving the fitting segment keeps its audio; changing the voice re-voices everything.
    await scripts.update(owner.id, projectId, [
      { id: 'a', startMs: 500, endMs: 2500, text: 'Welcome to the tour.' },
      { id: 'c', startMs: 3000, endMs: 4000, text: 'Open the settings page now.' },
    ]);
    const moved = await service.generate(owner.id, projectId, { voice: 'onyx', scope: 'changed' });
    expect(speech.calls).toHaveLength(2);
    expect(moved.segments.map((s) => s.status)).toEqual(['ready', 'ready']);
    expect((await prisma.voiceoverClip.findFirstOrThrow({ where: { segmentId: 'a' } })).startMs).toBe(500);

    await service.generate(owner.id, projectId, { voice: 'sage', scope: 'changed' });
    expect(speech.calls.slice(2).map((c) => c.voice)).toEqual(['sage', 'sage']);
  });

  it('regenerates one segment and validates the target', async () => {
    const speech = new FakeSpeech();
    const service = new VoiceoverService(scripts, storage, ffmpeg, speech);
    await service.generate(owner.id, projectId, { voice: 'coral', scope: 'all' });
    const before = await clipKeys();

    const after = await service.regenerateSegment(owner.id, projectId, 'c');
    expect(speech.calls.at(-1)).toEqual({ text: 'Open the settings page now.', voice: 'coral' });
    expect((await clipKeys()).c).not.toBe(before.c);
    expect((await clipKeys()).a).toBe(before.a);
    expect(after.segments.find((s) => s.segmentId === 'c')?.status).toBe('ready');

    await expect(service.regenerateSegment(owner.id, projectId, 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(service.regenerateSegment(owner.id, projectId, 'b')).rejects.toMatchObject({ status: 400 });
  });

  it('drops clips of removed segments and keeps partial results when TTS fails', async () => {
    const speech = new FakeSpeech();
    const service = new VoiceoverService(scripts, storage, ffmpeg, speech);
    await service.generate(owner.id, projectId, { voice: 'coral', scope: 'changed' });
    const removedKey = (await clipKeys()).a;

    await scripts.update(owner.id, projectId, [
      { id: 'c', startMs: 3000, endMs: 5000, text: 'Open the settings page now.' },
      { id: 'd', startMs: 5000, endMs: 8000, text: 'This one will FAIL.' },
    ]);
    await expect(service.generate(owner.id, projectId, { voice: 'coral', scope: 'changed' })).rejects.toMatchObject({
      status: 502,
    });
    expect(await storage.exists(removedKey)).toBe(false);
    const state = (await service.get(owner.id, projectId))!;
    expect(state.segments.map((s) => [s.segmentId, s.status])).toEqual([
      ['c', 'ready'],
      ['d', 'missing'],
    ]);
    expect(state.trackUrl).not.toBeNull();
  });

  it('removes generated files with the project', async () => {
    const service = new VoiceoverService(scripts, storage, ffmpeg, offlineSpeech);
    await service.generate(owner.id, projectId, { voice: 'coral', scope: 'changed' });
    const keys = Object.values(await clipKeys());
    await projects.delete(owner.id, projectId);
    expect(await prisma.voiceoverClip.count()).toBe(0);
    for (const key of keys) expect(await storage.exists(key)).toBe(false);
  });
});

describe('voiceover routes', () => {
  let owner: TestUser;
  let outsider: TestUser;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    outsider = await signUpUser(app, 'outsider@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
  });

  it('lists voices', async () => {
    const res = await request(app).get('/api/voices').set('Cookie', owner.cookie).expect(200);
    expect(res.body.mode).toBe('offline');
    expect(res.body.voices.map((v: { id: string }) => v.id)).toContain(res.body.defaultVoice);
  });

  it('generates, streams, regenerates and deletes a voiceover', async () => {
    const base = `/api/projects/${projectId}/voiceover`;
    await request(app).post(base).set('Cookie', owner.cookie).send({}).expect(404);
    await seedScript(projectId);
    expect((await request(app).get(base).set('Cookie', owner.cookie).expect(200)).body.voiceover).toBeNull();

    await request(app).post(base).set('Cookie', owner.cookie).send({ voice: 'robot' }).expect(400);
    const generated = await request(app).post(base).set('Cookie', owner.cookie).send({ voice: 'echo' }).expect(200);
    expect(generated.body.voiceover).toMatchObject({ voice: 'echo', trackDurationMs: 5000 });

    const track = await request(app).get(generated.body.voiceover.trackUrl).set('Cookie', owner.cookie).expect(200);
    expect(track.headers['content-type']).toBe('audio/mpeg');
    await request(app).get(generated.body.voiceover.segments[0].audioUrl).set('Cookie', owner.cookie).expect(200);
    await request(app).get(`${base}/segments/b/audio`).set('Cookie', owner.cookie).expect(404);

    const one = await request(app).post(`${base}/segments/a`).set('Cookie', owner.cookie).send({}).expect(200);
    expect(one.body.voiceover.segments[0].status).toBe('ready');

    await request(app).delete(base).set('Cookie', owner.cookie).expect(204);
    expect((await request(app).get(base).set('Cookie', owner.cookie).expect(200)).body.voiceover).toBeNull();
  });

  it('enforces access', async () => {
    const base = `/api/projects/${projectId}/voiceover`;
    await seedScript(projectId);
    await request(app).post(base).set('Cookie', owner.cookie).send({}).expect(200);

    await request(app).get(base).expect(401);
    await request(app).get(base).set('Cookie', outsider.cookie).expect(404);
    await request(app).get(`${base}/track`).set('Cookie', outsider.cookie).expect(404);

    await prisma.membership.create({ data: { userId: outsider.id, workspaceId: owner.workspaceId, role: 'viewer' } });
    await request(app).get(base).set('Cookie', outsider.cookie).expect(200);
    await request(app).get(`${base}/track`).set('Cookie', outsider.cookie).expect(200);
    await request(app).post(base).set('Cookie', outsider.cookie).send({}).expect(403);
    await request(app).post(`${base}/segments/a`).set('Cookie', outsider.cookie).send({}).expect(403);
    await request(app).delete(base).set('Cookie', outsider.cookie).expect(403);
  });
});
