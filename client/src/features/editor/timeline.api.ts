import { api } from '../../lib/ApiClient';
import type { TimelineDoc } from './timelineDoc';
import type { Click } from './zooms';

/** A project file the timeline can cut from; durationMs is null when the server couldn't read it. */
export interface TimelineSource {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  url: string;
  durationMs: number | null;
  /** Clicks captured while recording it in OpenClue; 0 for other files. */
  clickCount: number;
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
  clicks: (mediaId: string) => api.get<{ recording: { clicks: Click[] } }>(`/media/${mediaId}/recording`).then((r) => r.recording.clicks),
  save: (projectId: string, timeline: TimelineDoc) => api.put<TimelineData>(`/projects/${projectId}/timeline`, { timeline }),
};
