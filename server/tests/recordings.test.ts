import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { StorageService } from '../src/lib/storage';
import { MediaService } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import { RecordingService, normalizeClicks } from '../src/modules/recordings/recordings.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();
const media = new MediaService(new StorageService());
const service = new RecordingService(media);
const projects = new ProjectService();
afterAll(() => fs.rmSync(env.storageDir, { recursive: true, force: true }));

const metadata = {
  durationMs: 5000,
  width: 1280,
  height: 720,
  surface: 'browser' as const,
  hasAudio: true,
  clicks: [
    { t: 3000, x: 0.5, y: 0.5 },
    { t: 1000, x: 0.1, y: 0.9 },
    { t: 9000, x: 0.2, y: 0.2 },
  ],
};

function tempUpload(name: string, mimetype: string) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-rec-')), 'upload');
  fs.writeFileSync(filePath, 'webm-bytes');
  return { path: filePath, originalname: name, mimetype, size: 10 };
}

describe('normalizeClicks', () => {
  it('sorts by time and drops clicks past the end', () => {
    expect(normalizeClicks(metadata.clicks, metadata.durationMs).map((c) => c.t)).toEqual([1000, 3000]);
  });
});

describe('RecordingService', () => {
  let owner: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    outsider = await signUpUser(app, 'outsider@example.com');
  });

  it('stores the video in the project and keeps click data', async () => {
    const project = await projects.create(owner.id, owner.workspaceId, 'Demo');
    const asset = await service.create(owner.id, owner.workspaceId, tempUpload('rec.webm', 'video/webm'), metadata, project.id);

    expect(asset).toMatchObject({ kind: 'video', projectId: project.id, recording: { durationMs: 5000, clickCount: 2 } });
    const recording = await service.get(owner.id, asset.id);
    expect(recording).toMatchObject({ width: 1280, height: 720, surface: 'browser', hasAudio: true });
    expect(recording.clicks).toEqual([
      { t: 1000, x: 0.1, y: 0.9 },
      { t: 3000, x: 0.5, y: 0.5 },
    ]);
    // The summary travels with every media DTO.
    expect((await projects.get(owner.id, project.id)).media[0].recording).toEqual({ durationMs: 5000, clickCount: 2 });
  });

  it('rejects non-video files and hides recordings from outsiders', async () => {
    const image = tempUpload('shot.png', 'image/png');
    await expect(service.create(owner.id, owner.workspaceId, image, metadata)).rejects.toMatchObject({ status: 415 });
    expect(fs.existsSync(image.path)).toBe(false);

    const asset = await service.create(owner.id, owner.workspaceId, tempUpload('rec.webm', 'video/webm'), metadata);
    await expect(service.get(outsider.id, asset.id)).rejects.toMatchObject({ status: 404 });
  });

  it('404s for media that was uploaded rather than recorded', async () => {
    const plain = await media.upload(owner.id, owner.workspaceId, tempUpload('clip.mp4', 'video/mp4'));
    expect(plain.recording).toBeNull();
    await expect(service.get(owner.id, plain.id)).rejects.toMatchObject({ status: 404 });
  });

  it('deletes the recording metadata with its media asset', async () => {
    const asset = await service.create(owner.id, owner.workspaceId, tempUpload('rec.webm', 'video/webm'), metadata);
    await media.delete(owner.id, asset.id);
    expect(await prisma.recording.count()).toBe(0);
  });
});

describe('recording routes', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
  });

  it('uploads a recording with metadata and returns its clicks', async () => {
    const res = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/recordings`)
      .set('Cookie', owner.cookie)
      .field('metadata', JSON.stringify(metadata))
      .attach('file', Buffer.from('webm'), { filename: 'rec.webm', contentType: 'video/webm' })
      .expect(201);
    expect(res.body.media).toMatchObject({ kind: 'video', recording: { clickCount: 2 } });

    const detail = await request(app)
      .get(`/api/media/${res.body.media.id}/recording`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(detail.body.recording.clicks).toHaveLength(2);
  });

  it('validates metadata and file type without leaving temp files behind', async () => {
    const storage = new StorageService();
    const badJson = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/recordings`)
      .set('Cookie', owner.cookie)
      .field('metadata', '{not json')
      .attach('file', Buffer.from('webm'), { filename: 'rec.webm', contentType: 'video/webm' })
      .expect(400);
    expect(badJson.body.issues[0].message).toBe('metadata must be valid JSON');

    await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/recordings`)
      .set('Cookie', owner.cookie)
      .field('metadata', JSON.stringify({ ...metadata, clicks: [{ t: 1, x: 2, y: 0 }] }))
      .attach('file', Buffer.from('webm'), { filename: 'rec.webm', contentType: 'video/webm' })
      .expect(400);

    await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/recordings`)
      .set('Cookie', owner.cookie)
      .field('metadata', JSON.stringify(metadata))
      .attach('file', Buffer.from('png'), { filename: 'a.png', contentType: 'image/png' })
      .expect(415);

    expect(fs.readdirSync(storage.tmpDir)).toEqual([]);
    expect(await prisma.mediaAsset.count()).toBe(0);
  });
});
