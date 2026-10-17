import { api } from '../../lib/ApiClient';

/** Times are on the script's clock (its source video). Text may hold one line break. */
export interface CaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
}

export interface CaptionStyle {
  preset: string;
  fontFamily: 'sans' | 'serif' | 'mono';
  /** Fraction of the frame height. */
  fontSize: number;
  bold: boolean;
  uppercase: boolean;
  textColor: string;
  outline: boolean;
  backgroundColor: string;
  /** 0 hides the background box. */
  backgroundOpacity: number;
  position: 'bottom' | 'middle' | 'top';
}

export interface CaptionPreset {
  id: string;
  label: string;
  description: string;
  style: CaptionStyle;
}

export interface Captions {
  id: string;
  projectId: string;
  language: string;
  sourceMediaId: string | null;
  cues: CaptionCue[];
  style: CaptionStyle;
  maxCharsPerLine: number;
  maxLines: 1 | 2;
  /** voiceover: cues end when each spoken clip ends; script: cues fill each segment's slot. */
  timing: 'voiceover' | 'script';
  /** The script or voiceover changed after the cues were built. */
  stale: boolean;
  generatedAt: string;
  updatedAt: string;
}

export interface GenerateCaptionsOptions {
  maxCharsPerLine?: number;
  maxLines?: 1 | 2;
  preset?: string;
}

export type CaptionFormat = 'srt' | 'vtt';
export type CaptionTiming = 'auto' | 'script' | 'timeline';

export const captionsApi = {
  presets: () => api.get<{ presets: CaptionPreset[]; defaultPreset: string }>('/caption-presets'),
  get: (projectId: string) =>
    api.get<{ role: 'owner' | 'editor' | 'viewer'; captions: Captions | null }>(`/projects/${projectId}/captions`),
  generate: (projectId: string, options: GenerateCaptionsOptions) =>
    api.post<{ captions: Captions }>(`/projects/${projectId}/captions`, options).then((r) => r.captions),
  save: (projectId: string, changes: { cues?: CaptionCue[]; style?: CaptionStyle }) =>
    api.put<{ captions: Captions }>(`/projects/${projectId}/captions`, changes).then((r) => r.captions),
  /** A download link (the browser sends the session cookie). */
  exportUrl: (projectId: string, format: CaptionFormat, timing: CaptionTiming = 'auto') =>
    `/api/projects/${projectId}/captions/export?format=${format}&timing=${timing}`,
};
