import { api } from '../../lib/ApiClient';

export const MEDIA_KINDS = ['video', 'image', 'audio', 'pdf', 'slides'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MediaAsset {
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

/** Value for the file input's `accept` attribute; the server re-checks every upload. */
export const UPLOAD_ACCEPT = 'video/*,image/*,audio/*,application/pdf,.pdf,.ppt,.pptx,.odp,.key';

export const mediaApi = {
  list: (workspaceId: string, filter: { kind?: MediaKind; projectId?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.kind) params.set('kind', filter.kind);
    if (filter.projectId) params.set('projectId', filter.projectId);
    const qs = params.toString();
    return api
      .get<{ media: MediaAsset[] }>(`/workspaces/${workspaceId}/media${qs ? `?${qs}` : ''}`)
      .then((r) => r.media);
  },
  upload: (workspaceId: string, file: File, projectId?: string) => {
    const form = new FormData();
    if (projectId) form.append('projectId', projectId);
    form.append('file', file);
    return api.upload<{ media: MediaAsset }>(`/workspaces/${workspaceId}/media`, form).then((r) => r.media);
  },
  update: (id: string, changes: { name?: string; projectId?: string | null }) =>
    api.patch<{ media: MediaAsset }>(`/media/${id}`, changes).then((r) => r.media),
  remove: (id: string) => api.delete<void>(`/media/${id}`),
};
