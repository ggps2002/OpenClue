import { api } from '../../lib/ApiClient';
import type { TimelineDoc } from './Timeline';

/** A project file the timeline can cut from; durationMs is null when the server couldn't read it. */
export interface TimelineSource {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  url: string;
  durationMs: number | null;
}

export interface TimelineData {
  projectId: string;
  role: 'owner' | 'editor' | 'viewer';
  timeline: TimelineDoc | null;
  sources: TimelineSource[];
  voiceover: { url: string; durationMs: number } | null;
  updatedAt: string | null;
}

export const timelineApi = {
  get: (projectId: string) => api.get<TimelineData>(`/projects/${projectId}/timeline`),
  create: (projectId: string, mediaId?: string) => api.post<TimelineData>(`/projects/${projectId}/timeline`, { mediaId }),
  save: (projectId: string, timeline: TimelineDoc) => api.put<TimelineData>(`/projects/${projectId}/timeline`, { timeline }),
};
