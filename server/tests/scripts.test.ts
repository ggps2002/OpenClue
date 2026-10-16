import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { env } from '../src/config/env';
import { AiError, ClaudeClient } from '../src/lib/claude';
import { FfmpegService } from '../src/lib/ffmpeg';
import { prisma } from '../src/lib/prisma';
import { SpeechClient } from '../src/lib/speech';
import { StorageService } from '../src/lib/storage';
import { MediaService } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import { ScriptService } from '../src/modules/scripts/scripts.service';
import { TranscriptService } from '../src/modules/transcripts/transcripts.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();
const storage = new StorageService();
const media = new MediaService(storage);
const projects = new ProjectService();
const transcripts = new TranscriptService(media, storage, new FfmpegService(), new SpeechClient(undefined));
afterAll(() => fs.rmSync(env.storageDir, { recursive: true, force: true }));

/** Stands in for the Anthropic API: returns a canned reply or fails. */
class FakeClaude extends ClaudeClient {
  calls: string[] = [];
  constructor(private readonly reply: unknown | Error) {
    super(undefined);
  }
  override get isOnline(): boolean {
    return true;
  }
  override async generateJson<T>(req: { prompt: string; schema: z.ZodType<T> }): Promise<T> {
    this.calls.push(req.prompt);
    if (this.reply instanceof Error) throw this.reply;
    return req.schema.parse(this.reply);
  }
}

function tempUpload(name: string, mimetype: string) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-script-')), 'upload');
  fs.writeFileSync(filePath, 'not really media');
  return { path: filePath, originalname: name, mimetype, size: 16 };
}

describe('ScriptService', () => {
  let owner: TestUser;
  let projectId: string;
  let mediaId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
    mediaId = (await media.upload(owner.id, owner.workspaceId, tempUpload('take.mp4', 'video/mp4'), projectId)).id;
    // Gives the clip a known length without needing a real video file.
    await prisma.recording.create({
      data: { mediaAssetId: mediaId, durationMs: 20_000, width: 1280, height: 720, surface: 'browser', hasAudio: true, clickCount: 0, clicks: [] },
    });
  });

  it('drafts a script offline from a placeholder transcript', async () => {
    const service = new ScriptService(projects, media, transcripts, new ClaudeClient(undefined));
    const script = await service.generate(owner.id, projectId, { mediaId, retranscribe: false });

    expect(script).toMatchObject({ projectId, source: 'offline', sourceMediaId: mediaId, language: 'en' });
    expect(script.segments.length).toBeGreaterThan(0);
    expect(script.segments.at(-1)?.endMs).toBe(20_000);
    expect(script.segments.map((s) => s.text).join(' ')).not.toMatch(/\bum\b/i);
    expect(new Set(script.segments.map((s) => s.id)).size).toBe(script.segments.length);
    expect((await transcripts.get(owner.id, mediaId)).source).toBe('offline');
  });

  it('uses Claude when online and normalises its timing', async () => {
    const claude = new FakeClaude({
      segments: [
        { startMs: 5000, endMs: 25_000, text: 'Then open the settings.' },
        { startMs: 0, endMs: 6000, text: 'Welcome to the tour.' },
      ],
    });
    const service = new ScriptService(projects, media, transcripts, claude);
    const script = await service.generate(owner.id, projectId, { mediaId, retranscribe: false });

    expect(script.source).toBe('claude');
    expect(script.segments.map(({ startMs, endMs, text }) => ({ startMs, endMs, text }))).toEqual([
      { startMs: 0, endMs: 6000, text: 'Welcome to the tour.' },
      { startMs: 6000, endMs: 20_000, text: 'Then open the settings.' },
    ]);
    expect(claude.calls[0]).toContain('the video ends at 20000');
  });

  it('maps AI failures to a 502 and keeps the previous script', async () => {
    const offline = new ScriptService(projects, media, transcripts, new ClaudeClient(undefined));
    const first = await offline.generate(owner.id, projectId, { mediaId, retranscribe: false });

    const failing = new ScriptService(projects, media, transcripts, new FakeClaude(new AiError('boom')));
    await expect(failing.generate(owner.id, projectId, { mediaId, retranscribe: false })).rejects.toMatchObject({ status: 502 });
    expect(await offline.get(owner.id, projectId)).toEqual(first);
  });

  it('replaces the draft on regenerate instead of adding a second script', async () => {
    const service = new ScriptService(projects, media, transcripts, new ClaudeClient(undefined));
    const first = await service.generate(owner.id, projectId, { mediaId, retranscribe: false });
    const second = await service.generate(owner.id, projectId, { mediaId, retranscribe: true });
    expect(second.id).toBe(first.id);
    expect(await prisma.script.count()).toBe(1);
    expect(await prisma.transcript.count()).toBe(1);
  });
});

describe('script and transcript routes', () => {
  let owner: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let mediaId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    outsider = await signUpUser(app, 'outsider@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
    mediaId = (await media.upload(owner.id, owner.workspaceId, tempUpload('take.webm', 'video/webm'), projectId)).id;
  });

  it('generates, reads and edits a project script', async () => {
    const empty = await request(app).get(`/api/projects/${projectId}/script`).set('Cookie', owner.cookie).expect(200);
    expect(empty.body.script).toBeNull();

    const generated = await request(app)
      .post(`/api/projects/${projectId}/script`)
      .set('Cookie', owner.cookie)
      .send({ mediaId })
      .expect(200);
    const segments = generated.body.script.segments as { id: string; startMs: number; endMs: number; text: string }[];
    // An unreadable file falls back to a 30 s placeholder in offline mode.
    expect(segments.at(-1)?.endMs).toBe(30_000);

    const edited = [{ ...segments[0], text: 'Welcome to OpenClue.' }, ...segments.slice(1)];
    const saved = await request(app)
      .put(`/api/projects/${projectId}/script`)
      .set('Cookie', owner.cookie)
      .send({ segments: edited })
      .expect(200);
    expect(saved.body.script.segments[0].text).toBe('Welcome to OpenClue.');

    const reread = await request(app).get(`/api/projects/${projectId}/script`).set('Cookie', owner.cookie).expect(200);
    expect(reread.body.script.segments).toEqual(saved.body.script.segments);

    const transcript = await request(app).get(`/api/media/${mediaId}/transcript`).set('Cookie', owner.cookie).expect(200);
    expect(transcript.body.transcript).toMatchObject({ mediaId, source: 'offline' });
    expect(transcript.body.transcript.text.length).toBeGreaterThan(0);
  });

  it('validates edited segments', async () => {
    await request(app).put(`/api/projects/${projectId}/script`).set('Cookie', owner.cookie).send({ segments: [] }).expect(404);
    await request(app).post(`/api/projects/${projectId}/script`).set('Cookie', owner.cookie).send({ mediaId }).expect(200);

    const overlapping = await request(app)
      .put(`/api/projects/${projectId}/script`)
      .set('Cookie', owner.cookie)
      .send({
        segments: [
          { id: 'a', startMs: 0, endMs: 3000, text: 'One.' },
          { id: 'b', startMs: 2000, endMs: 4000, text: 'Two.' },
        ],
      })
      .expect(400);
    expect(overlapping.body.issues[0]).toEqual({ path: 'segments.1.startMs', message: 'Segments must be in order and must not overlap' });

    const backwards = await request(app)
      .put(`/api/projects/${projectId}/script`)
      .set('Cookie', owner.cookie)
      .send({ segments: [{ id: 'a', startMs: 3000, endMs: 1000, text: 'One.' }] })
      .expect(400);
    expect(backwards.body.issues[0].path).toBe('segments.0.endMs');
  });

  it('only scripts media from the same project', async () => {
    const loose = await media.upload(owner.id, owner.workspaceId, tempUpload('other.mp4', 'video/mp4'));
    await request(app).post(`/api/projects/${projectId}/script`).set('Cookie', owner.cookie).send({ mediaId: loose.id }).expect(400);

    const image = await media.upload(owner.id, owner.workspaceId, tempUpload('shot.png', 'image/png'), projectId);
    await request(app).post(`/api/projects/${projectId}/script`).set('Cookie', owner.cookie).send({ mediaId: image.id }).expect(400);
    await request(app).post(`/api/media/${image.id}/transcript`).set('Cookie', owner.cookie).expect(400);
  });

  it('enforces access', async () => {
    await request(app).get(`/api/projects/${projectId}/script`).expect(401);
    await request(app).get(`/api/projects/${projectId}/script`).set('Cookie', outsider.cookie).expect(404);
    await request(app).post(`/api/media/${mediaId}/transcript`).set('Cookie', outsider.cookie).expect(404);

    await prisma.membership.create({ data: { userId: outsider.id, workspaceId: owner.workspaceId, role: 'viewer' } });
    await request(app).get(`/api/projects/${projectId}/script`).set('Cookie', outsider.cookie).expect(200);
    await request(app).post(`/api/projects/${projectId}/script`).set('Cookie', outsider.cookie).send({ mediaId }).expect(403);
    await request(app).post(`/api/media/${mediaId}/transcript`).set('Cookie', outsider.cookie).expect(403);
  });
});
