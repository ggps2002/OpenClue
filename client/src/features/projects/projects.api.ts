import { api } from '../../lib/ApiClient';
import type { MediaAsset } from '../media/media.api';

export interface ProjectSummary {
  id: string;
  name: string;
  workspaceId: string;
  mediaCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  role: 'owner' | 'editor' | 'viewer';
  media: MediaAsset[];
}

export const projectsApi = {
  list: (workspaceId: string) =>
    api.get<{ projects: ProjectSummary[] }>(`/workspaces/${workspaceId}/projects`).then((r) => r.projects),
  create: (workspaceId: string, name: string) =>
    api.post<{ project: ProjectSummary }>(`/workspaces/${workspaceId}/projects`, { name }).then((r) => r.project),
  get: (id: string) => api.get<{ project: ProjectDetail }>(`/projects/${id}`).then((r) => r.project),
  rename: (id: string, name: string) =>
    api.patch<{ project: ProjectSummary }>(`/projects/${id}`, { name }).then((r) => r.project),
  remove: (id: string) => api.delete<void>(`/projects/${id}`),
};
