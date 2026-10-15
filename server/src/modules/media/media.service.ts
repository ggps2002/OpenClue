import fs from 'node:fs';
import path from 'node:path';
import type { MediaAsset } from '@prisma/client';
import { requireWorkspaceRole, type Role } from '../../lib/access';
import { prisma } from '../../lib/prisma';
import type { StorageService } from '../../lib/storage';
import { HttpError } from '../../middleware/error';
import type { ListMediaQuery, UpdateMediaInput } from './media.schema';

export const MEDIA_KINDS = ['video', 'image', 'audio', 'pdf', 'slides'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const SLIDE_EXTENSIONS = new Set(['.ppt', '.pptx', '.odp', '.key']);
const SLIDE_MIME_TYPES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.presentation',
  'application/x-iwork-keynote-sffkey',
]);

/** Classifies an upload by MIME type, falling back to the extension; null means unsupported. */
export function detectMediaKind(mimeType: string, fileName: string): MediaKind | null {
  const ext = path.extname(fileName).toLowerCase();
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (SLIDE_MIME_TYPES.has(mimeType) || SLIDE_EXTENSIONS.has(ext)) return 'slides';
  return null;
}

export interface MediaAssetDto {
  id: string;
  kind: MediaKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  projectId: string | null;
  workspaceId: string;
  url: string;
  createdAt: string;
}

/** A file multer has already written to the storage temp dir. */
export interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

export class MediaService {
  constructor(private readonly storage: StorageService) {}

  static toDto(this: void, asset: MediaAsset): MediaAssetDto {
    return {
      id: asset.id,
      kind: asset.kind as MediaKind,
      name: asset.originalName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      projectId: asset.projectId,
      workspaceId: asset.workspaceId,
      url: `/api/media/${asset.id}/file`,
      createdAt: asset.createdAt.toISOString(),
    };
  }

  async list(userId: string, workspaceId: string, query: ListMediaQuery): Promise<MediaAssetDto[]> {
    await requireWorkspaceRole(userId, workspaceId, 'viewer');
    const assets = await prisma.mediaAsset.findMany({
      where: { workspaceId, projectId: query.projectId, kind: query.kind },
      orderBy: { createdAt: 'desc' },
    });
    return assets.map(MediaService.toDto);
  }

  /** Moves a temp upload into storage and records it. The temp file is always cleaned up. */
  async upload(userId: string, workspaceId: string, file: UploadedFile, projectId?: string): Promise<MediaAssetDto> {
    try {
      await requireWorkspaceRole(userId, workspaceId, 'editor');
      const kind = detectMediaKind(file.mimetype, file.originalname);
      if (!kind) throw new HttpError(415, 'Unsupported file type');
      if (projectId) await this.assertProjectInWorkspace(projectId, workspaceId);

      const storageKey = this.storage.createKey(`media/${workspaceId}`, file.originalname);
      await this.storage.adopt(file.path, storageKey);
      const asset = await prisma.mediaAsset.create({
        data: {
          kind,
          originalName: file.originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          workspaceId,
          projectId: projectId ?? null,
          uploadedById: userId,
        },
      });
      if (projectId) await this.touchProject(projectId);
      return MediaService.toDto(asset);
    } finally {
      await fs.promises.rm(file.path, { force: true });
    }
  }

  /** Returns the asset and the absolute path of its file, for streaming. */
  async getFile(userId: string, mediaId: string): Promise<{ asset: MediaAssetDto; filePath: string }> {
    const asset = await this.load(userId, mediaId, 'viewer');
    return { asset: MediaService.toDto(asset), filePath: this.storage.resolve(asset.storageKey) };
  }

  async update(userId: string, mediaId: string, input: UpdateMediaInput): Promise<MediaAssetDto> {
    const asset = await this.load(userId, mediaId, 'editor');
    if (input.projectId) await this.assertProjectInWorkspace(input.projectId, asset.workspaceId);
    const updated = await prisma.mediaAsset.update({
      where: { id: mediaId },
      data: { originalName: input.name, projectId: input.projectId },
    });
    if (input.projectId) await this.touchProject(input.projectId);
    return MediaService.toDto(updated);
  }

  async delete(userId: string, mediaId: string): Promise<void> {
    const asset = await this.load(userId, mediaId, 'editor');
    await prisma.mediaAsset.delete({ where: { id: mediaId } });
    await this.storage.remove(asset.storageKey);
  }

  private async load(userId: string, mediaId: string, minRole: Role): Promise<MediaAsset> {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: mediaId } });
    if (!asset) throw new HttpError(404, 'File not found');
    try {
      await requireWorkspaceRole(userId, asset.workspaceId, minRole);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new HttpError(404, 'File not found');
      throw err;
    }
    return asset;
  }

  private async assertProjectInWorkspace(projectId: string, workspaceId: string): Promise<void> {
    const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId } });
    if (!project) throw new HttpError(400, 'Project not found in this workspace');
  }

  /** Bumps updatedAt so recently changed projects sort first. */
  private async touchProject(projectId: string): Promise<void> {
    await prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
  }
}
