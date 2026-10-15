import fs from 'node:fs';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/error';
import { detectMediaKind, type MediaAssetDto, type MediaService, type UploadedFile } from '../media/media.service';
import { clickSchema, SURFACES, type Click, type RecordingMetadata } from './recordings.schema';

export interface RecordingDto {
  mediaId: string;
  durationMs: number;
  width: number;
  height: number;
  surface: (typeof SURFACES)[number];
  hasAudio: boolean;
  clicks: Click[];
  createdAt: string;
}

export class RecordingService {
  constructor(private readonly media: MediaService) {}

  /** Stores a browser recording as a video media asset plus its capture metadata. */
  async create(
    userId: string,
    workspaceId: string,
    file: UploadedFile,
    metadata: RecordingMetadata,
    projectId?: string,
  ): Promise<MediaAssetDto> {
    if (detectMediaKind(file.mimetype, file.originalname) !== 'video') {
      await fs.promises.rm(file.path, { force: true });
      throw new HttpError(415, 'A recording must be a video file');
    }
    const asset = await this.media.upload(userId, workspaceId, file, projectId);
    const clicks = normalizeClicks(metadata.clicks, metadata.durationMs);
    try {
      await prisma.recording.create({
        data: {
          mediaAssetId: asset.id,
          durationMs: metadata.durationMs,
          width: metadata.width,
          height: metadata.height,
          surface: metadata.surface,
          hasAudio: metadata.hasAudio,
          clickCount: clicks.length,
          clicks,
        },
      });
    } catch (err) {
      await this.media.delete(userId, asset.id);
      throw err;
    }
    return { ...asset, recording: { durationMs: metadata.durationMs, clickCount: clicks.length } };
  }

  async get(userId: string, mediaId: string): Promise<RecordingDto> {
    await this.media.load(userId, mediaId, 'viewer');
    const recording = await prisma.recording.findUnique({ where: { mediaAssetId: mediaId } });
    if (!recording) throw new HttpError(404, 'This file was not recorded in OpenClue');
    return {
      mediaId,
      durationMs: recording.durationMs,
      width: recording.width,
      height: recording.height,
      surface: SURFACES.find((s) => s === recording.surface) ?? 'unknown',
      hasAudio: recording.hasAudio,
      clicks: clickSchema.array().parse(recording.clicks),
      createdAt: recording.createdAt.toISOString(),
    };
  }
}

/** Sorts clicks by time and drops any that fall after the end of the video. */
export function normalizeClicks(clicks: Click[], durationMs: number): Click[] {
  return clicks.filter((c) => c.t <= durationMs).sort((a, b) => a.t - b.t);
}
