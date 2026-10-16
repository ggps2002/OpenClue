import type { Project } from '@prisma/client';
import { requireWorkspaceRole, type Role } from '../../lib/access';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../middleware/error';
import { MediaService, mediaInclude, type MediaAssetDto } from '../media/media.service';

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  mediaCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  role: Role;
  media: MediaAssetDto[];
}

export class ProjectService {
  async list(userId: string, workspaceId: string): Promise<ProjectSummary[]> {
    await requireWorkspaceRole(userId, workspaceId, 'viewer');
    const projects = await prisma.project.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { mediaAssets: true } } },
    });
    return projects.map((p) => this.toSummary(p, p._count.mediaAssets));
  }

  async create(userId: string, workspaceId: string, name: string): Promise<ProjectSummary> {
    await requireWorkspaceRole(userId, workspaceId, 'editor');
    const project = await prisma.project.create({ data: { name, workspaceId, createdById: userId } });
    return this.toSummary(project, 0);
  }

  async get(userId: string, projectId: string): Promise<ProjectDetail> {
    const { project, role } = await this.load(userId, projectId, 'viewer');
    const media = await prisma.mediaAsset.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: mediaInclude,
    });
    return { ...this.toSummary(project, media.length), role, media: media.map(MediaService.toDto) };
  }

  async rename(userId: string, projectId: string, name: string): Promise<ProjectSummary> {
    await this.load(userId, projectId, 'editor');
    const project = await prisma.project.update({
      where: { id: projectId },
      data: { name },
      include: { _count: { select: { mediaAssets: true } } },
    });
    return this.toSummary(project, project._count.mediaAssets);
  }

  /** Deletes the project; its media stays in the workspace library, unlinked. */
  async delete(userId: string, projectId: string): Promise<void> {
    await this.load(userId, projectId, 'editor');
    await prisma.project.delete({ where: { id: projectId } });
  }

  /** Loads a project the user can access with at least `minRole`; 404 otherwise. */
  async load(userId: string, projectId: string, minRole: Role): Promise<{ project: Project; role: Role }> {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new HttpError(404, 'Project not found');
    try {
      return { project, role: await requireWorkspaceRole(userId, project.workspaceId, minRole) };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new HttpError(404, 'Project not found');
      throw err;
    }
  }

  private toSummary(project: Project, mediaCount: number): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      workspaceId: project.workspaceId,
      mediaCount,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
