import { api } from '../../lib/ApiClient';

export interface Voice {
  id: string;
  label: string;
  description: string;
}

export interface VoiceList {
  voices: Voice[];
  defaultVoice: string;
  /** "offline" when the server has no speech key and makes silent placeholder clips. */
  mode: 'online' | 'offline';
}

export type ClipStatus = 'ready' | 'stale' | 'missing' | 'empty';

export interface VoiceoverSegment {
  segmentId: string;
  status: ClipStatus;
  audioUrl: string | null;
  durationMs: number | null;
  tempo: number | null;
  overflowMs: number;
  source: 'openai' | 'offline' | null;
}

export interface Voiceover {
  projectId: string;
  scriptId: string;
  voice: string;
  trackUrl: string | null;
  trackDurationMs: number;
  offline: boolean;
  segments: VoiceoverSegment[];
  updatedAt: string;
}

export type GenerateScope = 'all' | 'changed';

export const voiceoverApi = {
  voices: () => api.get<VoiceList>('/voices'),
  get: (projectId: string) =>
    api.get<{ voiceover: Voiceover | null }>(`/projects/${projectId}/voiceover`).then((r) => r.voiceover),
  generate: (projectId: string, voice: string, scope: GenerateScope) =>
    api.post<{ voiceover: Voiceover }>(`/projects/${projectId}/voiceover`, { voice, scope }).then((r) => r.voiceover),
  regenerateSegment: (projectId: string, segmentId: string) =>
    api
      .post<{ voiceover: Voiceover }>(`/projects/${projectId}/voiceover/segments/${encodeURIComponent(segmentId)}`, {})
      .then((r) => r.voiceover),
};
