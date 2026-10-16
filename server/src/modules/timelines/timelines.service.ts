import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Role } from '../../lib/access';
import { mapLimit } from '../../lib/concurrency';
import type { FfmpegService } from '../../lib/ffmpeg';
import { prisma } from '../../lib/prisma';
import type { StorageService } from '../../lib/storage';
import { HttpError } from '../../middleware/error';
import type { ProjectService } from '../projects/projects.service';
import type { VoiceoverService } from '../voiceovers/voiceovers.service';
import { TIMELINE_VERSION, timelineDocSchema, type AudioClip, type TimelineDoc } from './timelines.schema';

/** Probed durations are rounded differently by browsers and ffmpeg; allow this much slack on out points. */
const DURATION_TOLERANCE_MS = 50;
const PROBE_CONCURRENCY = 2;

/** A project file the timeline can cut from. durationMs is null when ffmpeg couldn't read the file. */
export interface TimelineSourceDto {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  url: string;
  /** Always null for images. */
  durationMs: number | null;
}

export interface TimelineDto {
  projectId: string;
  role: Role;
  /** null until the user creates the edit. */
  timeline: TimelineDoc | null;
  sources: TimelineSourceDto[];
  voiceover: { url: string; durationMs: number } | null;
  updatedAt: string | null;
}

interface Context {
  role: Role;
  sources: TimelineSourceDto[];
  voiceover: TimelineDto['voiceover'];
}

/** Stores and validates the per-project edit (scenes cut from project videos, audio tracks and overlays). */
export class TimelineService {
  constructor(
    private readonly projects: ProjectService,
    private readonly voiceovers: VoiceoverService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {}

  async get(userId: string, projectId: string): Promise<TimelineDto> {
    const context = await this.context(userId, projectId, 'viewer');
    const stored = await prisma.timeline.findUnique({ where: { projectId } });
    return toDto(projectId, context, stored);
  }

  /**
   * Starts (or restarts) the edit from one project video: a single scene of the whole video, plus the
   * voiceover on its own track when there is one (the video's own sound is then muted).
   */
  async create(userId: string, projectId: string, mediaId?: string): Promise<TimelineDto> {
    const context = await this.context(userId, projectId, 'editor');
    const videos = context.sources.filter((s) => s.kind === 'video');
    const video = mediaId ? videos.find((s) => s.id === mediaId) : await this.defaultVideo(projectId, videos);
    if (!video) {
      throw new HttpError(mediaId ? 400 : 422, mediaId ? 'Pick a video from this project' : 'Add a video to this project first');
    }
    if (!video.durationMs) throw new HttpError(422, 'This video could not be read');

    const { voiceover } = context;
    const doc: TimelineDoc = {
      version: TIMELINE_VERSION,
      scenes: [{ id: randomUUID(), name: 'Scene 1', mediaId: video.id, inMs: 0, outMs: video.durationMs, muted: Boolean(voiceover) }],
      tracks: voiceover
        ? [
            {
              id: randomUUID(),
              kind: 'audio',
              name: 'Voiceover',
              muted: false,
              clips: [{ id: randomUUID(), source: { type: 'voiceover' }, startMs: 0, inMs: 0, outMs: voiceover.durationMs }],
            },
          ]
        : [],
    };
    return toDto(projectId, context, await this.store(projectId, doc));
  }

  /** Saves an edited timeline after checking that every cut lies inside a file of this project. */
  async save(userId: string, projectId: string, doc: TimelineDoc): Promise<TimelineDto> {
    const context = await this.context(userId, projectId, 'editor');
    const sources = new Map(context.sources.map((s) => [s.id, s]));

    doc.scenes.forEach((scene, i) => {
      const label = scene.name || `Scene ${i + 1}`;
      const source = sources.get(scene.mediaId);
      if (!source || source.kind !== 'video') {
        throw new HttpError(400, `${label} uses a video that is no longer in this project. Remove the scene to save.`);
      }
      assertWithin(source.durationMs, scene.outMs, `${label} ends after its video does`);
    });
    for (const track of doc.tracks) {
      if (track.kind === 'audio') {
        track.clips.forEach((clip) => this.checkClip(clip, track.name, sources, context.voiceover));
        continue;
      }
      for (const clip of track.clips) {
        if (clip.content.type === 'image' && sources.get(clip.content.mediaId)?.kind !== 'image') {
          throw new HttpError(400, `An image on ${track.name} is no longer in this project. Remove the overlay to save.`);
        }
      }
    }
    return toDto(projectId, context, await this.store(projectId, doc));
  }

  private checkClip(clip: AudioClip, trackName: string, sources: Map<string, TimelineSourceDto>, voiceover: Context['voiceover']) {
    if (clip.source.type === 'voiceover') {
      if (!voiceover) throw new HttpError(400, `${trackName} uses the voiceover, but this project has none. Remove the clip to save.`);
      assertWithin(voiceover.durationMs, clip.outMs, `A clip on ${trackName} runs past the end of the voiceover`);
      return;
    }
    const source = sources.get(clip.source.mediaId);
    if (!source || source.kind === 'image') throw new HttpError(400, `A clip on ${trackName} uses a file that is no longer in this project`);
    assertWithin(source.durationMs, clip.outMs, `A clip on ${trackName} runs past the end of its file`);
  }

  private async store(projectId: string, doc: TimelineDoc) {
    const data = doc as unknown as Prisma.InputJsonValue;
    return prisma.timeline.upsert({ where: { projectId }, create: { projectId, data }, update: { data } });
  }

  private async context(userId: string, projectId: string, minRole: Role): Promise<Context> {
    const { role } = await this.projects.load(userId, projectId, minRole);
    const [sources, voiceover] = await Promise.all([this.sources(projectId), this.voiceovers.get(userId, projectId)]);
    return {
      role,
      sources,
      voiceover: voiceover?.trackUrl ? { url: voiceover.trackUrl, durationMs: voiceover.trackDurationMs } : null,
    };
  }

  /** The project's videos, audio files and images, oldest first, probing (and remembering) unknown durations. */
  private async sources(projectId: string): Promise<TimelineSourceDto[]> {
    const assets = await prisma.mediaAsset.findMany({
      where: { projectId, kind: { in: ['video', 'audio', 'image'] } },
      orderBy: { createdAt: 'asc' },
      include: { recording: { select: { durationMs: true } } },
    });
    const unknown = assets.filter((a) => a.durationMs === null && a.kind !== 'image');
    await mapLimit(unknown, PROBE_CONCURRENCY, async (asset) => {
      const durationMs = asset.recording?.durationMs ?? (await this.ffmpeg.probeDurationMs(this.storage.resolve(asset.storageKey)));
      if (durationMs === null) return;
      asset.durationMs = durationMs;
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { durationMs } });
    });
    return assets.map((a) => ({
      id: a.id,
      name: a.originalName,
      kind: a.kind as TimelineSourceDto['kind'],
      url: `/api/media/${a.id}/file`,
      durationMs: a.durationMs,
    }));
  }

  /** The video the script was written from, else the newest project video. */
  private async defaultVideo(projectId: string, videos: TimelineSourceDto[]): Promise<TimelineSourceDto | undefined> {
    const script = await prisma.script.findFirst({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    return videos.find((v) => v.id === script?.sourceMediaId) ?? videos.at(-1);
  }
}

function assertWithin(durationMs: number | null, outMs: number, message: string): void {
  if (durationMs !== null && outMs > durationMs + DURATION_TOLERANCE_MS) throw new HttpError(400, message);
}

function toDto(projectId: string, context: Context, stored: { data: Prisma.JsonValue; updatedAt: Date } | null): TimelineDto {
  const parsed = stored ? timelineDocSchema.safeParse(stored.data) : null;
  if (parsed && !parsed.success) console.warn(`[timelines] stored timeline of project ${projectId} is invalid; ignoring it`);
  return {
    projectId,
    role: context.role,
    timeline: parsed?.success ? parsed.data : null,
    sources: context.sources,
    voiceover: context.voiceover,
    updatedAt: stored ? stored.updatedAt.toISOString() : null,
  };
}
