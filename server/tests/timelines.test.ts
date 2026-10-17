import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { ClaudeClient } from '../src/lib/claude';
import { FfmpegService } from '../src/lib/ffmpeg';
import { prisma } from '../src/lib/prisma';
import { SpeechClient } from '../src/lib/speech';
import { StorageService } from '../src/lib/storage';
import { MediaService } from '../src/modules/media/media.service';
import { ProjectService } from '../src/modules/projects/projects.service';
import { ScriptService } from '../src/modules/scripts/scripts.service';
import { timelineDocSchema, type OverlayClip, type TimelineDoc } from '../src/modules/timelines/timelines.schema';
import { TimelineService } from '../src/modules/timelines/timelines.service';
import { TranscriptService } from '../src/modules/transcripts/transcripts.service';
import { VoiceoverService } from '../src/modules/voiceovers/voiceovers.service';
import { createApp, resetDatabase, signUpUser, type TestUser } from './helpers';

const app = createApp();
const storage = new StorageService();
const ffmpeg = new FfmpegService();
const speech = new SpeechClient(undefined);
const media = new MediaService(storage);
const projects = new ProjectService(storage);
const scripts = new ScriptService(projects, media, new TranscriptService(media, storage, ffmpeg, speech), new ClaudeClient(undefined));
const voiceovers = new VoiceoverService(scripts, storage, ffmpeg, speech);
const service = new TimelineService(projects, voiceovers, storage, ffmpeg);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openclue-timeline-'));
afterAll(() => {
  fs.rmSync(env.storageDir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A real 2 s test-pattern video so the duration has to be probed with ffmpeg. */
async function makeVideo(name: string) {
  const filePath = path.join(tmp, `${Date.now()}-${name}`);
  await ffmpeg.exec(['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=160x120:rate=10', '-pix_fmt', 'yuv420p', '-f', 'mp4', filePath]);
  return { path: filePath, originalname: name, mimetype: 'video/mp4', size: fs.statSync(filePath).size };
}

/** A one-frame PNG to use as an image overlay. */
async function makeImage(name: string) {
  const filePath = path.join(tmp, `${Date.now()}-${name}`);
  await ffmpeg.exec(['-y', '-f', 'lavfi', '-i', 'color=c=red:size=16x16', '-frames:v', '1', filePath]);
  return { path: filePath, originalname: name, mimetype: 'image/png', size: fs.statSync(filePath).size };
}

function overlay(content: OverlayClip['content'], overrides: Partial<OverlayClip> = {}): OverlayClip {
  return {
    id: `o-${content.type}`,
    startMs: 0,
    durationMs: 1000,
    width: 0.3,
    height: 0.2,
    content,
    keyframes: [{ t: 0, x: 0.5, y: 0.5, scale: 1, opacity: 1, easing: 'linear' }],
    ...overrides,
  };
}

const textContent: OverlayClip['content'] = { type: 'text', text: 'Hello', color: '#ffffff', fontSize: 0.06, bold: true, align: 'center', background: null };

function doc(mediaId: string, overrides: Partial<TimelineDoc> = {}): TimelineDoc {
  return {
    version: 1,
    scenes: [
      { id: 's1', name: 'Intro', mediaId, inMs: 0, outMs: 800, muted: false },
      { id: 's2', name: 'Demo', mediaId, inMs: 1200, outMs: 2000, muted: true },
    ],
    tracks: [],
    ...overrides,
  };
}

describe('TimelineService', () => {
  let owner: TestUser;
  let projectId: string;
  let videoId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
    videoId = (await media.upload(owner.id, owner.workspaceId, await makeVideo('take.mp4'), projectId)).id;
  });

  it('lists probed sources and starts with no timeline', async () => {
    const dto = await service.get(owner.id, projectId);
    expect(dto).toMatchObject({ projectId, role: 'owner', timeline: null, voiceover: null, updatedAt: null });
    expect(dto.sources).toHaveLength(1);
    expect(dto.sources[0]).toMatchObject({ id: videoId, kind: 'video', name: 'take.mp4' });
    expect(Math.abs(dto.sources[0].durationMs! - 2000)).toBeLessThan(100);
    // The probe result is remembered.
    expect((await prisma.mediaAsset.findUnique({ where: { id: videoId } }))?.durationMs).toBe(dto.sources[0].durationMs);
  });

  it('seeds one scene of the whole video', async () => {
    const dto = await service.create(owner.id, projectId);
    const durationMs = dto.sources[0].durationMs;
    expect(dto.timeline?.tracks).toEqual([]);
    expect(dto.timeline?.scenes).toEqual([
      { id: expect.any(String), name: 'Scene 1', mediaId: videoId, inMs: 0, outMs: durationMs, muted: false },
    ]);
    expect(dto.updatedAt).not.toBeNull();
    expect((await service.get(owner.id, projectId)).timeline).toEqual(dto.timeline);
  });

  it('adds the voiceover on its own track and mutes the scene when there is one', async () => {
    await prisma.script.create({ data: { projectId, source: 'offline', segments: [{ id: 'a', startMs: 0, endMs: 1500, text: 'Hello there.' }] } });
    await voiceovers.generate(owner.id, projectId, { voice: 'coral', scope: 'all' });

    const dto = await service.create(owner.id, projectId);
    expect(dto.voiceover).toEqual({ url: expect.stringContaining(`/api/projects/${projectId}/voiceover/track`), durationMs: 1500 });
    expect(dto.timeline?.scenes[0].muted).toBe(true);
    expect(dto.timeline?.tracks).toEqual([
      {
        id: expect.any(String),
        kind: 'audio',
        name: 'Voiceover',
        muted: false,
        clips: [{ id: expect.any(String), source: { type: 'voiceover' }, startMs: 0, inMs: 0, outMs: 1500 }],
      },
    ]);
  });

  it('prefers the video the script was written from', async () => {
    const second = await media.upload(owner.id, owner.workspaceId, await makeVideo('second.mp4'), projectId);
    expect((await service.create(owner.id, projectId)).timeline?.scenes[0].mediaId).toBe(second.id);
    await prisma.script.create({ data: { projectId, source: 'offline', sourceMediaId: videoId, segments: [] } });
    expect((await service.create(owner.id, projectId)).timeline?.scenes[0].mediaId).toBe(videoId);
  });

  it('refuses to seed without a usable video', async () => {
    const empty = (await projects.create(owner.id, owner.workspaceId, 'Empty')).id;
    await expect(service.create(owner.id, empty)).rejects.toMatchObject({ status: 422 });
    await expect(service.create(owner.id, projectId, 'nope')).rejects.toMatchObject({ status: 400 });
  });

  it('saves edits and validates cuts against project files', async () => {
    const saved = await service.save(owner.id, projectId, doc(videoId));
    expect(saved.timeline?.scenes.map((s) => s.name)).toEqual(['Intro', 'Demo']);

    const tooLong = doc(videoId, { scenes: [{ id: 's1', name: 'Long', mediaId: videoId, inMs: 0, outMs: 9000, muted: false }] });
    await expect(service.save(owner.id, projectId, tooLong)).rejects.toThrow('Long ends after its video does');

    const other = (await projects.create(owner.id, owner.workspaceId, 'Other')).id;
    const foreign = (await media.upload(owner.id, owner.workspaceId, await makeVideo('other.mp4'), other)).id;
    await expect(service.save(owner.id, projectId, doc(foreign))).rejects.toThrow(/no longer in this project/);

    const voiceoverClip = doc(videoId, {
      tracks: [{ id: 't1', kind: 'audio', name: 'Voiceover', muted: false, clips: [{ id: 'c1', source: { type: 'voiceover' }, startMs: 0, inMs: 0, outMs: 500 }] }],
    });
    await expect(service.save(owner.id, projectId, voiceoverClip)).rejects.toThrow(/has none/);

    const musicClip = doc(videoId, {
      tracks: [{ id: 't1', kind: 'audio', name: 'Music', muted: false, clips: [{ id: 'c1', source: { type: 'media', mediaId: videoId }, startMs: 300, inMs: 0, outMs: 1000 }] }],
    });
    expect((await service.save(owner.id, projectId, musicClip)).timeline?.tracks[0].clips[0].startMs).toBe(300);
  });

  it('saves overlays and checks that images belong to the project', async () => {
    const imageId = (await media.upload(owner.id, owner.workspaceId, await makeImage('logo.png'), projectId)).id;
    expect((await service.get(owner.id, projectId)).sources.find((s) => s.id === imageId)).toMatchObject({ kind: 'image', durationMs: null });

    const clips = [
      overlay(textContent),
      overlay({ type: 'shape', shape: 'ellipse', fill: '#ff0000', stroke: null }),
      overlay({ type: 'image', mediaId: imageId }),
    ];
    const withOverlays = doc(videoId, { tracks: [{ id: 't1', kind: 'overlay', name: 'Overlay 1', hidden: false, clips }] });
    expect((await service.save(owner.id, projectId, withOverlays)).timeline?.tracks).toEqual(withOverlays.tracks);

    const missing = doc(videoId, {
      tracks: [{ id: 't1', kind: 'overlay', name: 'Overlay 1', hidden: false, clips: [overlay({ type: 'image', mediaId: videoId })] }],
    });
    await expect(service.save(owner.id, projectId, missing)).rejects.toThrow(/no longer in this project/);

    // An image is not an audio source.
    const imageAudio = doc(videoId, {
      tracks: [{ id: 't1', kind: 'audio', name: 'Music', muted: false, clips: [{ id: 'c1', source: { type: 'media', mediaId: imageId }, startMs: 0, inMs: 0, outMs: 500 }] }],
    });
    await expect(service.save(owner.id, projectId, imageAudio)).rejects.toThrow(/no longer in this project/);
  });

  it('rejects keyframes out of order or past the end of the overlay', () => {
    const k = (t: number) => ({ t, x: 0.5, y: 0.5, scale: 1, opacity: 1, easing: 'linear' as const });
    const parse = (keyframes: OverlayClip['keyframes']) =>
      timelineDocSchema.safeParse(doc('m', { tracks: [{ id: 't1', kind: 'overlay', name: 'O', hidden: false, clips: [overlay(textContent, { keyframes })] }] })).success;
    expect(parse([k(0), k(500), k(1000)])).toBe(true);
    expect(parse([k(0), k(0)])).toBe(false);
    expect(parse([k(600), k(300)])).toBe(false);
    expect(parse([k(0), k(1500)])).toBe(false);
    expect(parse([])).toBe(false);
  });

  it('saves transitions and keeps them within half of each scene they join', async () => {
    const withTransition = (sceneIndex: number, transition: TimelineDoc['scenes'][number]['transition']) => {
      const base = doc(videoId);
      base.scenes[sceneIndex] = { ...base.scenes[sceneIndex], transition };
      return base;
    };
    // Both scenes are 800 ms long, so 400 ms is the longest transition between them.
    const saved = await service.save(owner.id, projectId, withTransition(1, { type: 'fade', durationMs: 400 }));
    expect(saved.timeline?.scenes[1].transition).toEqual({ type: 'fade', durationMs: 400 });
    const parse = (d: TimelineDoc) => timelineDocSchema.safeParse(d).success;
    expect(parse(withTransition(1, null))).toBe(true);
    expect(parse(withTransition(1, { type: 'slideleft', durationMs: 401 }))).toBe(false);
    expect(parse(withTransition(1, { type: 'fade', durationMs: 50 }))).toBe(false);
    expect(parse(withTransition(0, { type: 'fade', durationMs: 200 }))).toBe(false);
    expect(parse(withTransition(1, { type: 'spin' as 'fade', durationMs: 200 }))).toBe(false);
  });

  it('reports recorded clicks on sources and saves zooms in source time', async () => {
    await prisma.recording.create({
      data: { mediaAssetId: videoId, durationMs: 2000, width: 1280, height: 720, surface: 'browser', hasAudio: false, clickCount: 2, clicks: [{ t: 300, x: 0.2, y: 0.3 }, { t: 900, x: 0.8, y: 0.7 }] },
    });
    expect((await service.get(owner.id, projectId)).sources[0]).toMatchObject({ id: videoId, clickCount: 2 });

    const zoom = (id: string, startMs: number, durationMs = 600) => ({ id, startMs, durationMs, x: 0.2, y: 0.3, scale: 2, spotlight: true });
    const withZooms = (zooms: ReturnType<typeof zoom>[]) => {
      const base = doc(videoId);
      base.scenes[0] = { ...base.scenes[0], zooms };
      return base;
    };
    // Zooms may sit outside the scene's in/out points (kept for when it is trimmed back).
    const saved = await service.save(owner.id, projectId, withZooms([zoom('z1', 0), zoom('z2', 1300)]));
    expect(saved.timeline?.scenes[0].zooms?.map((z) => z.id)).toEqual(['z1', 'z2']);
    await expect(service.save(owner.id, projectId, withZooms([zoom('z1', 1800)]))).rejects.toThrow(/zoom in Intro runs past the end/);

    const parse = (d: TimelineDoc) => timelineDocSchema.safeParse(d).success;
    expect(parse(withZooms([zoom('z1', 0), zoom('z2', 500)]))).toBe(false);
    expect(parse(withZooms([zoom('z2', 1000), zoom('z1', 0)]))).toBe(false);
    expect(parse(withZooms([zoom('z1', 0, 300)]))).toBe(false);
    expect(parse(withZooms([{ ...zoom('z1', 0), scale: 5 }]))).toBe(false);
    expect(parse(withZooms([zoom('s2', 0)]))).toBe(false);
  });

  it('is removed with its project', async () => {
    await service.create(owner.id, projectId);
    await projects.delete(owner.id, projectId);
    expect(await prisma.timeline.count()).toBe(0);
  });
});

describe('timeline routes', () => {
  let owner: TestUser;
  let projectId: string;
  let videoId: string;

  beforeEach(async () => {
    await resetDatabase();
    owner = await signUpUser(app, 'owner@example.com');
    projectId = (await projects.create(owner.id, owner.workspaceId, 'Demo')).id;
    videoId = (await media.upload(owner.id, owner.workspaceId, await makeVideo('take.mp4'), projectId)).id;
  });

  it('creates, reads and saves a timeline', async () => {
    const created = await request(app).post(`/api/projects/${projectId}/timeline`).set('Cookie', owner.cookie).send({}).expect(200);
    expect(created.body.timeline.scenes).toHaveLength(1);

    await request(app).put(`/api/projects/${projectId}/timeline`).set('Cookie', owner.cookie).send({ timeline: doc(videoId) }).expect(200);
    const read = await request(app).get(`/api/projects/${projectId}/timeline`).set('Cookie', owner.cookie).expect(200);
    expect(read.body.timeline.scenes.map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
  });

  it('rejects malformed timelines', async () => {
    const shortScene = doc(videoId, { scenes: [{ id: 's1', name: 'x', mediaId: videoId, inMs: 0, outMs: 50, muted: false }] });
    await request(app).put(`/api/projects/${projectId}/timeline`).set('Cookie', owner.cookie).send({ timeline: shortScene }).expect(400);
    const duplicate = doc(videoId, {
      scenes: [
        { id: 's1', name: 'a', mediaId: videoId, inMs: 0, outMs: 500, muted: false },
        { id: 's1', name: 'b', mediaId: videoId, inMs: 500, outMs: 1000, muted: false },
      ],
    });
    await request(app).put(`/api/projects/${projectId}/timeline`).set('Cookie', owner.cookie).send({ timeline: duplicate }).expect(400);
  });

  it('lets viewers read but not edit, and hides it from outsiders', async () => {
    const viewer = await signUpUser(app, 'viewer@example.com');
    await prisma.membership.create({ data: { userId: viewer.id, workspaceId: owner.workspaceId, role: 'viewer' } });
    const read = await request(app).get(`/api/projects/${projectId}/timeline`).set('Cookie', viewer.cookie).expect(200);
    expect(read.body.role).toBe('viewer');
    await request(app).post(`/api/projects/${projectId}/timeline`).set('Cookie', viewer.cookie).send({}).expect(403);

    const outsider = await signUpUser(app, 'outsider@example.com');
    await request(app).get(`/api/projects/${projectId}/timeline`).set('Cookie', outsider.cookie).expect(404);
    await request(app).get(`/api/projects/${projectId}/timeline`).expect(401);
  });
});
