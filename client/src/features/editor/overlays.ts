/** Overlay types and keyframe maths. Mirrors the overlay part of server/src/modules/timelines/timelines.schema.ts. */

export type OverlayContent =
  | { type: 'text'; text: string; color: string; fontSize: number; bold: boolean; align: 'left' | 'center' | 'right'; background: string | null }
  | { type: 'shape'; shape: 'rectangle' | 'ellipse'; fill: string | null; stroke: string | null }
  | { type: 'image'; mediaId: string };

export type OverlayKind = OverlayContent['type'];
export type Easing = 'linear' | 'easeInOut';

/** Animated values; x/y are the box centre as fractions of the 16:9 frame. */
export interface OverlayValues {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

/** `t` is ms after the overlay starts; `easing` shapes the move towards the next keyframe. */
export interface Keyframe extends OverlayValues {
  t: number;
  easing: Easing;
}

export interface OverlayClip {
  id: string;
  startMs: number;
  durationMs: number;
  /** Box size as fractions of the frame width/height. */
  width: number;
  height: number;
  content: OverlayContent;
  keyframes: Keyframe[];
}

export interface OverlayTrack {
  id: string;
  kind: 'overlay';
  name: string;
  hidden: boolean;
  clips: OverlayClip[];
}

export const DEFAULT_OVERLAY_MS = 3000;
export const FADE_MS = 300;
/** Keyframes closer than this to the playhead are edited instead of adding a new one. */
export const KEYFRAME_SNAP_MS = 50;

const LIMITS: Record<keyof OverlayValues, [number, number]> = { x: [-1, 2], y: [-1, 2], scale: [0, 10], opacity: [0, 1] };

const round = (value: number) => Math.round(value * 1000) / 1000;

export function clampValues(values: Partial<OverlayValues>): Partial<OverlayValues> {
  const result: Partial<OverlayValues> = {};
  for (const key of Object.keys(values) as (keyof OverlayValues)[]) {
    const value = values[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const [min, max] = LIMITS[key];
    result[key] = round(Math.max(min, Math.min(max, value)));
  }
  return result;
}

const ease = (p: number, easing: Easing) => (easing === 'linear' ? p : p * p * (3 - 2 * p));

/** The overlay's values `localMs` after it starts, interpolated between keyframes (held before the first and after the last). */
export function valuesAt(clip: Pick<OverlayClip, 'keyframes'>, localMs: number): OverlayValues {
  const frames = clip.keyframes;
  const pick = ({ x, y, scale, opacity }: OverlayValues): OverlayValues => ({ x, y, scale, opacity });
  if (localMs <= frames[0].t) return pick(frames[0]);
  const nextIndex = frames.findIndex((k) => k.t > localMs);
  if (nextIndex === -1) return pick(frames[frames.length - 1]);
  const from = frames[nextIndex - 1];
  const to = frames[nextIndex];
  const p = ease((localMs - from.t) / (to.t - from.t), from.easing);
  const mix = (a: number, b: number) => a + (b - a) * p;
  return { x: mix(from.x, to.x), y: mix(from.y, to.y), scale: mix(from.scale, to.scale), opacity: mix(from.opacity, to.opacity) };
}

/** The keyframe at (or within snapping distance of) `localMs`, if any. */
export function keyframeNear(clip: OverlayClip, localMs: number): Keyframe | undefined {
  return clip.keyframes.find((k) => Math.abs(k.t - localMs) <= KEYFRAME_SNAP_MS);
}

/**
 * Changes the overlay's values at `localMs`. A single-keyframe overlay is static, so its one keyframe
 * is edited; otherwise the keyframe under the playhead is edited, or a new one is added there.
 */
export function setValuesAt(clip: OverlayClip, localMs: number, values: Partial<OverlayValues>): OverlayClip {
  const changes = clampValues(values);
  const target = clip.keyframes.length === 1 ? clip.keyframes[0] : keyframeNear(clip, localMs);
  if (target) return { ...clip, keyframes: clip.keyframes.map((k) => (k === target ? { ...k, ...changes } : k)) };
  return addKeyframe(clip, localMs, changes);
}

/** Inserts a keyframe at `localMs` holding the current interpolated values (plus any changes). */
export function addKeyframe(clip: OverlayClip, localMs: number, changes: Partial<OverlayValues> = {}): OverlayClip {
  const t = Math.round(Math.max(0, Math.min(clip.durationMs, localMs)));
  if (clip.keyframes.some((k) => k.t === t)) return clip;
  const previous = [...clip.keyframes].reverse().find((k) => k.t < t);
  const keyframe: Keyframe = { t, ...valuesAt(clip, t), ...clampValues(changes), easing: previous?.easing ?? 'easeInOut' };
  return { ...clip, keyframes: [...clip.keyframes, keyframe].sort((a, b) => a.t - b.t) };
}

/** Removes a keyframe; the last one always stays. */
export function removeKeyframe(clip: OverlayClip, t: number): OverlayClip {
  if (clip.keyframes.length <= 1) return clip;
  return { ...clip, keyframes: clip.keyframes.filter((k) => k.t !== t) };
}

export function updateKeyframe(clip: OverlayClip, t: number, changes: Partial<Pick<Keyframe, keyof OverlayValues | 'easing'>>): OverlayClip {
  const { easing, ...values } = changes;
  return {
    ...clip,
    keyframes: clip.keyframes.map((k) => (k.t === t ? { ...k, ...clampValues(values), ...(easing ? { easing } : {}) } : k)),
  };
}

/**
 * Changes the overlay's length. Keyframes keep their offset from the start; ones that no longer fit
 * are dropped (the first always stays, pulled inside if needed).
 */
export function setDuration(clip: OverlayClip, durationMs: number): OverlayClip {
  const duration = Math.max(100, Math.round(durationMs));
  const kept = clip.keyframes.filter((k, i) => i === 0 || k.t <= duration).map((k) => (k.t > duration ? { ...k, t: duration } : k));
  return { ...clip, durationMs: duration, keyframes: kept };
}

/** Replaces the animation with a fade in and out around the overlay's current look at its start. */
export function fadeInOut(clip: OverlayClip): OverlayClip {
  const fade = Math.min(FADE_MS, Math.floor(clip.durationMs / 3));
  const base = { ...valuesAt(clip, 0), easing: 'easeInOut' as const };
  return {
    ...clip,
    keyframes: [
      { ...base, t: 0, opacity: 0 },
      { ...base, t: fade, opacity: 1 },
      { ...base, t: clip.durationMs - fade, opacity: 1 },
      { ...base, t: clip.durationMs, opacity: 0 },
    ],
  };
}

/** A new overlay of `kind`, centred in the frame. */
export function createOverlay(id: string, kind: OverlayKind, startMs: number, imageId?: string): OverlayClip {
  const content: OverlayContent =
    kind === 'text'
      ? { type: 'text', text: 'Your text', color: '#ffffff', fontSize: 0.07, bold: true, align: 'center', background: '#111827' }
      : kind === 'shape'
        ? { type: 'shape', shape: 'rectangle', fill: null, stroke: '#f43f5e' }
        : { type: 'image', mediaId: imageId ?? '' };
  const size = kind === 'text' ? { width: 0.5, height: 0.14 } : kind === 'shape' ? { width: 0.25, height: 0.2 } : { width: 0.25, height: 0.25 };
  return {
    id,
    startMs: Math.max(0, Math.round(startMs)),
    durationMs: DEFAULT_OVERLAY_MS,
    ...size,
    content,
    keyframes: [{ t: 0, x: 0.5, y: 0.5, scale: 1, opacity: 1, easing: 'easeInOut' }],
  };
}

export const overlayLabel = (clip: OverlayClip): string =>
  clip.content.type === 'text' ? clip.content.text.trim() || 'Text' : clip.content.type === 'shape' ? `${clip.content.shape === 'ellipse' ? 'Ellipse' : 'Rectangle'}` : 'Image';
