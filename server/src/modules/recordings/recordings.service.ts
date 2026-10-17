import fs from 'node:fs';
import path from 'node:path';
import type { FfmpegService } from '../../lib/ffmpeg';
import { prisma } from '../../lib/prisma';
import type { StorageService } from '../../lib/storage';
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
  constructor(
    private readonly media: MediaService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {}

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
    const uploaded = await this.media.upload(userId, workspaceId, file, projectId);
    const asset = await this.makeSeekable(uploaded);
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

  /**
   * MediaRecorder WebM files have no duration or seek index, so players can't seek them.
   * A copy-remux through ffmpeg adds both. Best effort: on failure the original file is kept.
   */
  private async makeSeekable(asset: MediaAssetDto): Promise<MediaAssetDto> {
    const stored = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } });
    const filePath = this.storage.resolve(stored.storageKey);
    const tmpKey = this.storage.createKey('tmp', stored.storageKey);
    const tmpPath = this.storage.resolve(tmpKey);
    try {
      await this.ffmpeg.remux(filePath, tmpPath);
      await fs.promises.rename(tmpPath, filePath);
      const { size } = await fs.promises.stat(filePath);
      await prisma.mediaAsset.update({ where: { id: asset.id }, data: { sizeBytes: size } });
      return { ...asset, sizeBytes: size };
    } catch (err) {
      console.warn(`[recordings] could not remux ${path.basename(filePath)}; keeping the original`, (err as Error).message);
      await this.storage.remove(tmpKey);
      return asset;
    }
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
