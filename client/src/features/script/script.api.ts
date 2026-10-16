import { api } from '../../lib/ApiClient';

export interface ScriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface Script {
  id: string;
  projectId: string;
  language: string;
  /** How the first draft was written: by the AI, or by the offline cleanup. */
  source: 'claude' | 'offline';
  sourceMediaId: string | null;
  segments: ScriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface Transcript {
  mediaId: string;
  language: string;
  source: 'openai' | 'offline';
  segments: { startMs: number; endMs: number; text: string }[];
  text: string;
  createdAt: string;
}

export const scriptApi = {
  get: (projectId: string) => api.get<{ script: Script | null }>(`/projects/${projectId}/script`).then((r) => r.script),
  generate: (projectId: string, mediaId: string, retranscribe = false) =>
    api.post<{ script: Script }>(`/projects/${projectId}/script`, { mediaId, retranscribe }).then((r) => r.script),
  save: (projectId: string, segments: ScriptSegment[]) =>
    api.put<{ script: Script }>(`/projects/${projectId}/script`, { segments }).then((r) => r.script),
  transcript: (mediaId: string) =>
    api.get<{ transcript: Transcript }>(`/media/${mediaId}/transcript`).then((r) => r.transcript),
};
