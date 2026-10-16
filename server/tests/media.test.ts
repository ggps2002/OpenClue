import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { StorageService } from '../src/lib/storage';
import { MediaService, detectMediaKind } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();
const storage = new StorageService();
afterAll(() => fs.rmSync(env.storageDir, { recursive: true, force: true }));

function tempUpload(name: string, mimetype: string, contents = 'fake-bytes') {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-up-')), 'upload');
  fs.writeFileSync(filePath, contents);
  return { path: filePath, originalname: name, mimetype, size: contents.length };
}

describe('detectMediaKind', () => {
  it('classifies by MIME type and extension', () => {
    expect(detectMediaKind('video/webm', 'rec.webm')).toBe('video');
    expect(detectMediaKind('image/png', 'shot.png')).toBe('image');
    expect(detectMediaKind('audio/mpeg', 'vo.mp3')).toBe('audio');
    expect(detectMediaKind('application/pdf', 'guide.pdf')).toBe('pdf');
    expect(detectMediaKind('application/octet-stream', 'guide.PDF')).toBe('pdf');
    expect(detectMediaKind('application/octet-stream', 'deck.pptx')).toBe('slides');
    expect(detectMediaKind('application/vnd.ms-powerpoint', 'deck')).toBe('slides');
    expect(detectMediaKind('application/zip', 'archive.zip')).toBeNull();
  });
});

describe('MediaService', () => {
  const service = new MediaService(storage);
  const projects = new ProjectService(storage);
  let owner: TestUser;
  let outsider: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    outsider = await signUpUser(app, 'outsider@example.com');
  });

  it('stores an upload, links it to a project and removes the temp file', async () => {
    const project = await projects.create(owner.id, owner.workspaceId, 'Demo');
    const file = tempUpload('Demo.mp4', 'video/mp4');
    const asset = await service.upload(owner.id, owner.workspaceId, file, project.id);

    expect(asset).toMatchObject({ kind: 'video', name: 'Demo.mp4', projectId: project.id, url: `/api/media/${asset.id}/file` });
    expect(fs.existsSync(file.path)).toBe(false);
    const { filePath } = await service.getFile(owner.id, asset.id);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('fake-bytes');
    expect((await projects.get(owner.id, project.id)).media.map((m) => m.id)).toEqual([asset.id]);
  });

  it('filters the library by project and kind', async () => {
    const project = await projects.create(owner.id, owner.workspaceId, 'Demo');
    const video = await service.upload(owner.id, owner.workspaceId, tempUpload('a.mp4', 'video/mp4'), project.id);
    const image = await service.upload(owner.id, owner.workspaceId, tempUpload('b.png', 'image/png'));

    expect((await service.list(owner.id, owner.workspaceId, {})).map((m) => m.id)).toEqual([image.id, video.id]);
    expect((await service.list(owner.id, owner.workspaceId, { kind: 'image' })).map((m) => m.id)).toEqual([image.id]);
    expect((await service.list(owner.id, owner.workspaceId, { projectId: project.id })).map((m) => m.id)).toEqual([video.id]);
  });

  it('rejects unsupported files, foreign projects and outsiders, cleaning up temp files', async () => {
    const zip = tempUpload('a.zip', 'application/zip');
    await expect(service.upload(owner.id, owner.workspaceId, zip)).rejects.toMatchObject({ status: 415 });
    expect(fs.existsSync(zip.path)).toBe(false);

    const foreign = await projects.create(outsider.id, outsider.workspaceId, 'Theirs');
    await expect(
      service.upload(owner.id, owner.workspaceId, tempUpload('a.png', 'image/png'), foreign.id),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      service.upload(outsider.id, owner.workspaceId, tempUpload('a.png', 'image/png')),
    ).rejects.toMatchObject({ status: 404 });
    expect(await prisma.mediaAsset.count()).toBe(0);
  });

  it('renames, moves between projects, keeps media when a project is deleted, and deletes files', async () => {
    const project = await projects.create(owner.id, owner.workspaceId, 'Demo');
    const asset = await service.upload(owner.id, owner.workspaceId, tempUpload('a.pdf', 'application/pdf'));
    const { filePath } = await service.getFile(owner.id, asset.id);

    const moved = await service.update(owner.id, asset.id, { projectId: project.id, name: 'Guide.pdf' });
    expect(moved).toMatchObject({ projectId: project.id, name: 'Guide.pdf' });

    await projects.delete(owner.id, project.id);
    expect((await service.list(owner.id, owner.workspaceId, {}))[0]).toMatchObject({ id: asset.id, projectId: null });

    await expect(service.delete(outsider.id, asset.id)).rejects.toMatchObject({ status: 404 });
    await service.delete(owner.id, asset.id);
    expect(fs.existsSync(filePath)).toBe(false);
    await expect(service.getFile(owner.id, asset.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('media routes', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
  });

  it('uploads a file, lists it and streams it back with range support', async () => {
    const project = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/projects`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Demo' });
    const upload = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/media`)
      .set('Cookie', owner.cookie)
      .field('projectId', project.body.project.id)
      .attach('file', Buffer.from('0123456789'), { filename: 'clip.webm', contentType: 'video/webm' })
      .expect(201);
    const media = upload.body.media as { id: string; url: string };
    expect(upload.body.media).toMatchObject({ kind: 'video', name: 'clip.webm', sizeBytes: 10 });

    const list = await request(app)
      .get(`/api/workspaces/${owner.workspaceId}/media?kind=video`)
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(list.body.media).toHaveLength(1);

    const full = await request(app).get(media.url).set('Cookie', owner.cookie).expect(200);
    expect(full.headers['content-type']).toBe('video/webm');
    expect(full.body.toString()).toBe('0123456789');

    const partial = await request(app).get(media.url).set('Cookie', owner.cookie).set('Range', 'bytes=2-4').expect(206);
    expect(partial.body.toString()).toBe('234');

    await request(app).get(media.url).expect(401);
  });

  it('rejects unsupported types and missing files', async () => {
    const bad = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/media`)
      .set('Cookie', owner.cookie)
      .attach('file', Buffer.from('x'), { filename: 'tool.exe', contentType: 'application/x-msdownload' })
      .expect(415);
    expect(bad.body.error).toMatch(/Unsupported file type/);

    await request(app).post(`/api/workspaces/${owner.workspaceId}/media`).set('Cookie', owner.cookie).expect(400);
    await request(app)
      .get(`/api/workspaces/${owner.workspaceId}/media?kind=spreadsheet`)
      .set('Cookie', owner.cookie)
      .expect(400);
  });

  it('updates and deletes media', async () => {
    const upload = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/media`)
      .set('Cookie', owner.cookie)
      .attach('file', Buffer.from('img'), { filename: 'shot.png', contentType: 'image/png' });
    const id = upload.body.media.id as string;

    await request(app).patch(`/api/media/${id}`).set('Cookie', owner.cookie).send({}).expect(400);
    const renamed = await request(app)
      .patch(`/api/media/${id}`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Hero shot.png' })
      .expect(200);
    expect(renamed.body.media.name).toBe('Hero shot.png');

    await request(app).delete(`/api/media/${id}`).set('Cookie', owner.cookie).expect(204);
    await request(app).get(`/api/media/${id}/file`).set('Cookie', owner.cookie).expect(404);
  });
});
