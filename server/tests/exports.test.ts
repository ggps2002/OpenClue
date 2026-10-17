import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { FfmpegError, FfmpegService, type RunOptions } from '../src/lib/ffmpeg';
import { JobQueue } from '../src/lib/jobQueue';
import { prisma } from '../src/lib/prisma';
import { StorageService } from '../src/lib/storage';
import { ExportService } from '../src/modules/exports/exports.service';
import { MediaService } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import type { TimelineDoc } from '../src/modules/timelines/timelines.schema';
import { Server } from '../src/server';
import { resetDatabase, signUpUser, type TestUser } from './helpers';

const server = new Server();
const app = server.app;
const storage = new StorageService();
const ffmpeg = new FfmpegService();
const media = new MediaService(storage);
const projects = new ProjectService(storage);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-exports-'));
afterAll(() => {
  fs.rmSync(env.storageDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A 2 s test pattern with a tone, small so renders stay quick. */
async function makeVideo(name: string) {
  const filePath = path.join(tmp, `${Date.now()}-${name}`);
  await ffmpeg.exec([
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-pix_fmt', 'yuv420p', '-shortest', '-f', 'mp4', filePath,
  ]);
  return { path: filePath, originalname: name, mimetype: 'video/mp4', size: fs.statSync(filePath).size };
}

function edit(mediaId: string, extra: Partial<TimelineDoc> = {}): TimelineDoc {
  return {
    version: 1,
    scenes: [
      { id: 's1', name: 'One', mediaId, inMs: 0, outMs: 1500, muted: false },
      { id: 's2', name: 'Two', mediaId, inMs: 500, outMs: 2000, muted: false, transition: { type: 'fade', durationMs: 500 } },
    ],
    tracks: [],
    ...extra,
  };
}

async function saveEdit(projectId: string, doc: TimelineDoc) {
  const data = doc as unknown as Prisma.InputJsonValue;
  await prisma.timeline.upsert({ where: { projectId }, create: { projectId, data }, update: { data } });
}

describe('exports', () => {
  let owner: TestUser;
  let projectId: string;
  let videoId: string;

  beforeEach(async () => {
    await server.jobs.idle();
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Launch Demo')).id;
    videoId = (await media.upload(owner.id, owner.workspaceId, await makeVideo('take.mp4'), projectId)).id;
  });

  const post = (body: object, user = owner) => request(app).post(`/api/projects/${projectId}/exports`).set('Cookie', user.cookie).send(body);

  it('needs a saved edit with scenes', async () => {
    expect((await post({ format: 'mp4' }).expect(422)).body.error).toMatch(/editor/);
    await saveEdit(projectId, { version: 1, scenes: [], tracks: [] });
    expect((await post({ format: 'mp4' }).expect(422)).body.error).toMatch(/scene/);
    await post({ format: 'webm' }).expect(400);
  });

  it('renders an MP4 in the background, serves it and counts the minutes', async () => {
    await saveEdit(projectId, edit(videoId));
    const created = (await post({ format: 'mp4', quality: '720p' }).expect(201)).body.export;
    expect(created).toMatchObject({ format: 'mp4', quality: '720p', width: 1280, height: 720, status: 'queued', durationMs: 2500, fileUrl: null });
    await request(app).get(`/api/exports/${created.id}/file`).set('Cookie', owner.cookie).expect(409);

    await server.jobs.idle();
    const done = (await request(app).get(`/api/exports/${created.id}`).set('Cookie', owner.cookie).expect(200)).body.export;
    expect(done).toMatchObject({ status: 'done', progress: 1, error: null, queuePosition: null });
    expect(done.sizeBytes).toBeGreaterThan(1000);

    const file = await request(app).get(done.downloadUrl).set('Cookie', owner.cookie).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('video/mp4');
    expect(file.headers['content-disposition']).toContain("attachment; filename*=UTF-8''launch-demo-720p.mp4");
    const saved = path.join(tmp, 'rendered.mp4');
    fs.writeFileSync(saved, file.body as Buffer);
    expect(Math.abs((await ffmpeg.probeDurationMs(saved))! - 2500)).toBeLessThan(100);
    expect(await ffmpeg.hasAudio(saved)).toBe(true);

    const usage = (await request(app).get('/api/usage').set('Cookie', owner.cookie).expect(200)).body.usage;
    expect(usage).toMatchObject({ exportMs: 2500, exportMinutes: 0 });
    expect(usage.month).toMatch(/^\d{4}-\d{2}$/);

    // Deleting the export removes the file but not the minutes used.
    await request(app).delete(`/api/exports/${created.id}`).set('Cookie', owner.cookie).expect(204);
    const list = (await request(app).get(`/api/projects/${projectId}/exports`).set('Cookie', owner.cookie).expect(200)).body;
    expect(list.exports).toEqual([]);
    expect(list.usage.exportMs).toBe(2500);
    expect(fs.readdirSync(storage.resolve(`projects/${projectId}/exports`))).toEqual([]);
  });

  it('renders GIFs, which have a length limit', async () => {
    await saveEdit(projectId, edit(videoId));
    const created = (await post({ format: 'gif' }).expect(201)).body.export;
    expect(created).toMatchObject({ format: 'gif', quality: 'medium', width: 640, height: 360 });
    await server.jobs.idle();
    const file = await request(app).get(`/api/exports/${created.id}/file`).set('Cookie', owner.cookie).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('image/gif');
    expect((file.body as Buffer).subarray(0, 6).toString()).toBe('GIF89a');

    const long = edit(videoId, {
      tracks: [{ id: 'o', kind: 'overlay', name: 'Text', hidden: false, clips: [{
        id: 'oc', startMs: 60_000, durationMs: 1000, width: 0.3, height: 0.1,
        content: { type: 'shape', shape: 'rectangle', fill: '#ffffff', stroke: null },
        keyframes: [{ t: 0, x: 0.5, y: 0.5, scale: 1, opacity: 1, easing: 'linear' }],
      }] }],
    });
    await saveEdit(projectId, long);
    expect((await post({ format: 'gif' }).expect(422)).body.error).toMatch(/60 seconds/);
  });

  it('cancels a waiting export when it is deleted', async () => {
    await saveEdit(projectId, edit(videoId));
    const first = (await post({ format: 'gif', quality: 'small' }).expect(201)).body.export;
    const second = (await post({ format: 'gif', quality: 'small' }).expect(201)).body.export;
    const waiting = (await request(app).get(`/api/exports/${second.id}`).set('Cookie', owner.cookie)).body.export;
    expect(waiting.queuePosition).toBe(1);
    await request(app).delete(`/api/exports/${second.id}`).set('Cookie', owner.cookie).expect(204);
    await server.jobs.idle();
    expect((await prisma.export.findUnique({ where: { id: first.id } }))?.status).toBe('done');
    expect(await prisma.export.count()).toBe(1);
    expect(await prisma.usageEvent.count()).toBe(1);
  });

  it('refuses edits that use missing files or a missing voiceover', async () => {
    await saveEdit(projectId, edit(videoId, {
      tracks: [{ id: 't', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c', source: { type: 'voiceover' }, startMs: 0, inMs: 0, outMs: 1000 }] }],
    }));
    expect((await post({ format: 'mp4' }).expect(422)).body.error).toMatch(/voiceover/);
    await saveEdit(projectId, edit('gone'));
    expect((await post({ format: 'mp4' }).expect(422)).body.error).toMatch(/no longer in this project/);
  });

  it('checks access: viewers can list but not export, strangers see nothing', async () => {
    await saveEdit(projectId, edit(videoId));
    const viewer = await signUpUser(app, 'viewer@example.com');
    await prisma.membership.create({ data: { userId: viewer.id, workspaceId: owner.workspaceId, role: 'viewer' } });
    const stranger = await signUpUser(app, 'stranger@example.com');

    await post({ format: 'mp4' }, viewer).expect(403);
    const created = (await post({ format: 'gif', quality: 'small' }).expect(201)).body.export;
    expect((await request(app).get(`/api/projects/${projectId}/exports`).set('Cookie', viewer.cookie).expect(200)).body.role).toBe('viewer');
    await request(app).delete(`/api/exports/${created.id}`).set('Cookie', viewer.cookie).expect(403);
    await request(app).get(`/api/exports/${created.id}`).set('Cookie', stranger.cookie).expect(404);
    await request(app).get(`/api/projects/${projectId}/exports`).set('Cookie', stranger.cookie).expect(404);
    await request(app).get('/api/usage').expect(401);
  });

  it('removes exports with their project', async () => {
    await saveEdit(projectId, edit(videoId));
    await post({ format: 'gif', quality: 'small' }).expect(201);
    await server.jobs.idle();
    await request(app).delete(`/api/projects/${projectId}`).set('Cookie', owner.cookie).expect(204);
    expect(await prisma.export.count()).toBe(0);
    expect(fs.existsSync(storage.resolve(`projects/${projectId}`))).toBe(false);
  });
});

describe('ExportService', () => {
  class BrokenFfmpeg extends FfmpegService {
    override async exec(args: string[], options?: RunOptions): Promise<void> {
      if (args.includes('-filter_complex')) throw new FfmpegError('ffmpeg exited with code 1: bad input', 'bad input');
      return super.exec(args, options);
    }
  }

  let owner: TestUser;
  let projectId: string;
  let videoId: string;

  beforeEach(async () => {
    await server.jobs.idle();
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
    videoId = (await media.upload(owner.id, owner.workspaceId, await makeVideo('take.mp4'), projectId)).id;
    await saveEdit(projectId, edit(videoId));
  });

  it('marks failed renders and charges nothing', async () => {
    const queue = new JobQueue(1);
    const service = new ExportService(projects, storage, new BrokenFfmpeg(), queue);
    const created = await service.create(owner.id, projectId, { format: 'mp4', quality: '720p' });
    await queue.idle();
    const failed = await service.get(owner.id, created.id);
    expect(failed).toMatchObject({ status: 'failed', fileUrl: null });
    expect(failed.error).toMatch(/Rendering failed/);
    expect((await service.usage(owner.id)).exportMs).toBe(0);
  });

  it('stops ffmpeg when a rendering export is deleted', async () => {
    const queue = new JobQueue(1);
    const service = new ExportService(projects, storage, ffmpeg, queue);
    const created = await service.create(owner.id, projectId, { format: 'mp4', quality: '1080p' });
    while ((await service.get(owner.id, created.id)).status !== 'rendering') await new Promise((r) => setTimeout(r, 5));
    await service.remove(owner.id, created.id);
    await queue.idle();
    expect(await prisma.export.count()).toBe(0);
    expect(await prisma.usageEvent.count()).toBe(0);
    expect(fs.readdirSync(storage.resolve(`projects/${projectId}/exports`))).toEqual([]);
  });

  it('marks unfinished exports failed after a restart', async () => {
    const service = new ExportService(projects, storage, ffmpeg, new JobQueue(1));
    const item = await prisma.export.create({
      data: { projectId, createdById: owner.id, format: 'mp4', quality: '720p', width: 1280, height: 720, fps: 30, durationMs: 1000, storageKey: 'projects/x/exports/a.mp4', status: 'rendering' },
    });
    expect(await service.recover()).toBe(1);
    expect((await service.get(owner.id, item.id)).error).toMatch(/restarted/);
  });

  it('totals usage per calendar month', async () => {
    const service = new ExportService(projects, storage, ffmpeg, new JobQueue(1));
    const row = (amount: number, createdAt: string) => ({ userId: owner.id, workspaceId: owner.workspaceId, kind: 'export', amount, createdAt: new Date(createdAt) });
    await prisma.usageEvent.createMany({
      data: [row(90_000, '2026-03-01T00:00:00Z'), row(60_000, '2026-03-31T23:59:59Z'), row(5_000, '2026-02-28T23:59:59Z'), row(7_000, '2026-04-01T00:00:00Z')],
    });
    expect(await service.usage(owner.id, new Date('2026-03-15T12:00:00Z'))).toEqual({ month: '2026-03', exportMs: 150_000, exportMinutes: 2.5 });
  });
});
