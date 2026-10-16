import type { OverlayTrack } from './overlays';
import type { Transition } from './transitions';
import type { Zoom } from './zooms';

/** Mirrors server/src/modules/timelines/timelines.schema.ts. */
export interface Scene {
  id: string;
  name: string;
  mediaId: string;
  inMs: number;
  outMs: number;
  /** Silences the video's own sound. */
  muted: boolean;
  /** Transition from the previous scene into this one; absent or null is a hard cut. */
  transition?: Transition | null;
  /** Zoom/spotlight effects in source time, ordered and not overlapping. */
  zooms?: Zoom[];
}

export type AudioSource = { type: 'voiceover' } | { type: 'media'; mediaId: string };

export interface AudioClip {
  id: string;
  source: AudioSource;
  /** Where the clip starts on the timeline. */
  startMs: number;
  inMs: number;
  outMs: number;
}

export interface AudioTrack {
  id: string;
  kind: 'audio';
  name: string;
  muted: boolean;
  clips: AudioClip[];
}

export type Track = AudioTrack | OverlayTrack;

export interface TimelineDoc {
  version: 1;
  scenes: Scene[];
  /** Audio and overlay tracks; later overlay tracks are drawn on top. */
  tracks: Track[];
}

export const MIN_CLIP_MS = 100;

export const clipLength = (clip: { inMs: number; outMs: number }) => clip.outMs - clip.inMs;
