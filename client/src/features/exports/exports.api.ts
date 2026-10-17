import { api } from '../../lib/ApiClient';

export type ExportFormat = 'mp4' | 'gif';
export type ExportStatus = 'queued' | 'rendering' | 'done' | 'failed';

export interface ExportItem {
  id: string;
  projectId: string;
  format: ExportFormat;
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
  /** Inline playback and attachment download of the result; null until done. */
  fileUrl: string | null;
  downloadUrl: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Usage {
  /** e.g. "2026-10" (UTC). */
  month: string;
  exportMs: number;
  exportMinutes: number;
}

export interface ExportList {
  role: 'owner' | 'editor' | 'viewer';
  exports: ExportItem[];
  usage: Usage;
}

export const EXPORT_OPTIONS: Record<ExportFormat, { value: string; label: string }[]> = {
  mp4: [
    { value: '1080p', label: 'Full HD 1080p' },
    { value: '720p', label: 'HD 720p' },
  ],
  gif: [
    { value: 'medium', label: 'Medium (640 px wide)' },
    { value: 'small', label: 'Small (480 px wide)' },
  ],
};

/** GIFs over this length are refused by the server. */
export const MAX_GIF_MS = 60_000;

export const isActive = (item: ExportItem) => item.status === 'queued' || item.status === 'rendering';

export const exportsApi = {
  list: (projectId: string) => api.get<ExportList>(`/projects/${projectId}/exports`),
  create: (projectId: string, format: ExportFormat, quality: string) =>
    api.post<{ export: ExportItem }>(`/projects/${projectId}/exports`, { format, quality }).then((r) => r.export),
  get: (exportId: string) => api.get<{ export: ExportItem }>(`/exports/${exportId}`).then((r) => r.export),
  remove: (exportId: string) => api.delete<void>(`/exports/${exportId}`),
};
