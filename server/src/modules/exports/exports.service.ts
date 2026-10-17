import fs from 'node:fs';
import path from 'node:path';
import type { Export, Project } from '@prisma/client';
import type { Role } from '../../lib/access';
import { mapLimit } from '../../lib/concurrency';
import { FfmpegError, type FfmpegService } from '../../lib/ffmpeg';
import { slug } from '../../lib/filename';
import type { JobQueue } from '../../lib/jobQueue';
import { prisma } from '../../lib/prisma';
import type { StorageService } from '../../lib/storage';
import { HttpError } from '../../middleware/error';
import { projectFilesPrefix, type ProjectService } from '../projects/projects.service';
import { timelineDocSchema, type TimelineDoc } from '../timelines/timelines.schema';
import { EXPORT_QUALITIES, MAX_GIF_MS, type CreateExportInput } from './exports.schema';
import { buildRenderPlan, timelineDurationMs, type RenderMedia, type RenderPlan, type RenderSources } from './render';

export type ExportStatus = 'queued' | 'rendering' | 'done' | 'failed';

export interface ExportDto {
  id: string;
  projectId: string;
  format: 'mp4' | 'gif';
  quality: string;
  width: number;
  height: number;
  status: ExportStatus;
  /** 0..1 */
  progress: number;
  /** 1 = next in line; null unless queued. */
  queuePosition: number | null;
  durationMs: number;
  sizeBytes: number | null;
  error: string | null;
  /** Inline playback URL, and the same file as an attachment; null until done. */
  fileUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface UsageDto {
  /** Calendar month (UTC) the totals cover, e.g. "2026-10". */
  month: string;
  exportMs: number;
  exportMinutes: number;
}

/** Writing progress on every ffmpeg status line would hammer the database; this is plenty for polling. */
const PROGRESS_WRITE_MS = 500;
const PROBE_CONCURRENCY = 2;

/** Renders project timelines to MP4/GIF files through the render queue and meters export minutes per user. */
export class ExportService {
  constructor(
    private readonly projects: ProjectService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
    private readonly queue: JobQueue,
  ) {}

  async list(userId: string, projectId: string): Promise<{ role: Role; exports: ExportDto[]; usage: UsageDto }> {
    const { role } = await this.projects.load(userId, projectId, 'viewer');
    const exports = await prisma.export.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
    return { role, exports: exports.map((e) => this.toDto(e)), usage: await this.usage(userId) };
  }

  async get(userId: string, exportId: string): Promise<ExportDto> {
    return this.toDto((await this.load(userId, exportId, 'viewer')).item);
  }

  /** Queues a render of the project's saved timeline as it is right now. */
  async create(userId: string, projectId: string, input: CreateExportInput): Promise<ExportDto> {
    const { project } = await this.projects.load(userId, projectId, 'editor');
    const stored = await prisma.timeline.findUnique({ where: { projectId } });
    const parsed = stored ? timelineDocSchema.safeParse(stored.data) : null;
    if (!parsed?.success) throw new HttpError(422, 'Create and save the edit in the editor first');
    const doc = parsed.data;
    if (doc.scenes.length === 0) throw new HttpError(422, 'Add at least one scene to the edit first');
    const durationMs = timelineDurationMs(doc);
    if (input.format === 'gif' && durationMs > MAX_GIF_MS) {
      throw new HttpError(422, `GIFs can be at most ${MAX_GIF_MS / 1000} seconds long. Export an MP4 or shorten the edit.`);
    }

    const sources = await this.sources(project, doc);
    const { width, height, fps } = qualityOf(input);
    const storageKey = this.storage.createKey(`${projectFilesPrefix(projectId)}/exports`, `export.${input.format}`);
    const plan = buildRenderPlan(doc, sources, { format: input.format, width, height, fps }, this.storage.resolve(storageKey));
    const item = await prisma.export.create({
      data: { projectId, createdById: userId, format: input.format, quality: input.quality, width, height, fps, durationMs: plan.durationMs, storageKey },
    });
    this.queue.enqueue(item.id, (signal) => this.render(item, project, plan, signal));
    return this.toDto(item);
  }

  /** Cancels the render if it hasn't finished and deletes the export and its file. */
  async remove(userId: string, exportId: string): Promise<void> {
    const { item } = await this.load(userId, exportId, 'editor');
    this.queue.cancel(item.id);
    await prisma.export.deleteMany({ where: { id: item.id } });
    await this.storage.remove(item.storageKey);
  }

  /** The finished file, for streaming or download. */
  async file(userId: string, exportId: string): Promise<{ path: string; filename: string; contentType: string }> {
    const { item, project } = await this.load(userId, exportId, 'viewer');
    if (item.status !== 'done') throw new HttpError(409, 'This export is not ready yet');
    if (!(await this.storage.exists(item.storageKey))) throw new HttpError(404, 'The exported file is missing');
    return {
      path: this.storage.resolve(item.storageKey),
      filename: `${slug(project.name, 'video')}-${item.quality}.${item.format}`,
      contentType: item.format === 'gif' ? 'image/gif' : 'video/mp4',
    };
  }

  /** Export minutes the user rendered this calendar month (UTC). Deleting exports doesn't give minutes back. */
  async usage(userId: string, now: Date = new Date()): Promise<UsageDto> {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const total = await prisma.usageEvent.aggregate({
      where: { userId, kind: 'export', createdAt: { gte: from, lt: to } },
      _sum: { amount: true },
    });
    const exportMs = total._sum.amount ?? 0;
    return { month: from.toISOString().slice(0, 7), exportMs, exportMinutes: Math.round((exportMs / 60_000) * 10) / 10 };
  }

  /** Renders don't survive a restart (the queue is in memory), so unfinished ones are marked failed at startup. */
  async recover(): Promise<number> {
    const { count } = await prisma.export.updateMany({
      where: { status: { in: ['queued', 'rendering'] } },
      data: { status: 'failed', error: 'The server restarted before this export finished. Please export again.', finishedAt: new Date() },
    });
    return count;
  }

  private async render(item: Export, project: Project, plan: RenderPlan, signal: AbortSignal) {
    const output = this.storage.resolve(item.storageKey);
    if (!(await this.patch(item.id, { status: 'rendering', startedAt: new Date() }))) return;

    let lastWrite = 0;
    let progressWrite: Promise<unknown> = Promise.resolve();
    const onProgress = (timeMs: number) => {
      const now = Date.now();
      if (now - lastWrite < PROGRESS_WRITE_MS) return;
      lastWrite = now;
      progressWrite = this.patch(item.id, { progress: Math.min(0.99, timeMs / Math.max(1, plan.durationMs)) });
    };

    let size: number;
    try {
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      await this.ffmpeg.exec(plan.args, { signal, onProgress });
      size = (await fs.promises.stat(output)).size;
    } catch (err) {
      await progressWrite;
      await this.storage.remove(item.storageKey);
      if (signal.aborted) return;
      console.error(`[exports] render ${item.id} failed`, err instanceof FfmpegError ? err.stderr.slice(-2000) : err);
      await this.patch(item.id, { status: 'failed', error: 'Rendering failed. Check that the files in the edit still play, then try again.', finishedAt: new Date() });
      return;
    }

    // A late progress write must not land after "done".
    await progressWrite;
    const finished = await this.patch(item.id, { status: 'done', progress: 1, sizeBytes: size, finishedAt: new Date() });
    if (!finished) {
      // Deleted while rendering.
      await this.storage.remove(item.storageKey);
      return;
    }
    await prisma.usageEvent.create({ data: { userId: item.createdById, workspaceId: project.workspaceId, kind: 'export', amount: plan.durationMs } });
  }

  /** Updates the export unless it was deleted meanwhile; returns whether it still exists. */
  private async patch(id: string, data: Partial<Pick<Export, 'status' | 'progress' | 'sizeBytes' | 'error' | 'startedAt' | 'finishedAt'>>): Promise<boolean> {
    const { count } = await prisma.export.updateMany({ where: { id }, data });
    return count > 0;
  }

  /** Resolves every file the edit uses, checking it still belongs to the project. */
  private async sources(project: Project, doc: TimelineDoc): Promise<RenderSources> {
    const mediaIds = new Set(doc.scenes.map((s) => s.mediaId));
    let usesVoiceover = false;
    for (const track of doc.tracks) {
      if (track.kind !== 'audio' || track.muted) continue;
      for (const clip of track.clips) {
        if (clip.source.type === 'media') mediaIds.add(clip.source.mediaId);
        else usesVoiceover = true;
      }
    }

    const assets = await prisma.mediaAsset.findMany({ where: { id: { in: [...mediaIds] }, projectId: project.id } });
    if (assets.length !== mediaIds.size) throw new HttpError(422, 'The edit uses a file that is no longer in this project. Fix the edit in the editor first.');
    const media = new Map<string, RenderMedia>();
    await mapLimit(assets, PROBE_CONCURRENCY, async (asset) => {
      const file = this.storage.resolve(asset.storageKey);
      if (!(await this.storage.exists(asset.storageKey))) throw new HttpError(422, `${asset.originalName} is missing from storage`);
      media.set(asset.id, { path: file, hasAudio: await this.ffmpeg.hasAudio(file) });
    });

    let voiceoverPath: string | null = null;
    if (usesVoiceover) {
      const script = await prisma.script.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' }, include: { voiceover: true } });
      const key = script?.voiceover?.trackKey;
      if (!key || !(await this.storage.exists(key))) throw new HttpError(422, 'The edit uses the voiceover, but it has no audio. Generate the voiceover first.');
      voiceoverPath = this.storage.resolve(key);
    }
    return { media, voiceoverPath };
  }

  private async load(userId: string, exportId: string, minRole: Role): Promise<{ item: Export; project: Project }> {
    const item = await prisma.export.findUnique({ where: { id: exportId } });
    if (!item) throw new HttpError(404, 'Export not found');
    try {
      const { project } = await this.projects.load(userId, item.projectId, minRole);
      return { item, project };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new HttpError(404, 'Export not found');
      throw err;
    }
  }

  private toDto(item: Export): ExportDto {
    const done = item.status === 'done';
    return {
      id: item.id,
      projectId: item.projectId,
      format: item.format === 'gif' ? 'gif' : 'mp4',
      quality: item.quality,
      width: item.width,
      height: item.height,
      status: item.status as ExportStatus,
      progress: item.progress,
      queuePosition: item.status === 'queued' ? this.queue.position(item.id) : null,
      durationMs: item.durationMs,
      sizeBytes: item.sizeBytes,
      error: item.error,
      fileUrl: done ? `/api/exports/${item.id}/file` : null,
      downloadUrl: done ? `/api/exports/${item.id}/file?download=1` : null,
      createdAt: item.createdAt.toISOString(),
      finishedAt: item.finishedAt?.toISOString() ?? null,
    };
  }
}

function qualityOf(input: CreateExportInput): { width: number; height: number; fps: number } {
  return input.format === 'gif' ? EXPORT_QUALITIES.gif[input.quality] : EXPORT_QUALITIES.mp4[input.quality];
}
