/** Mirrors the transition rules in server/src/modules/timelines/timelines.schema.ts. */
export const TRANSITION_TYPES = ['fade', 'fadeblack', 'wipeleft', 'wiperight', 'slideleft', 'slideup'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/** How a scene takes over from the one before it; the two scenes overlap by `durationMs`. */
export interface Transition {
  type: TransitionType;
  durationMs: number;
}

export const MIN_TRANSITION_MS = 100;
export const MAX_TRANSITION_MS = 5000;
export const DEFAULT_TRANSITION_MS = 500;

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: 'Crossfade',
  fadeblack: 'Fade through black',
  wipeleft: 'Wipe left',
  wiperight: 'Wipe right',
  slideleft: 'Slide left',
  slideup: 'Slide up',
};

/** A transition may use at most half of each scene it joins, so a scene never overlaps two neighbours at once. */
export function maxTransitionMs(previousLengthMs: number, lengthMs: number): number {
  return Math.min(MAX_TRANSITION_MS, Math.floor(Math.min(previousLengthMs, lengthMs) / 2));
}

/** Clamps a transition to what the two scenes allow; null when they are too short for any transition. */
export function fitTransition(transition: Transition, previousLengthMs: number, lengthMs: number): Transition | null {
  const max = maxTransitionMs(previousLengthMs, lengthMs);
  if (max < MIN_TRANSITION_MS) return null;
  const durationMs = Math.max(MIN_TRANSITION_MS, Math.min(max, Math.round(transition.durationMs)));
  return durationMs === transition.durationMs ? transition : { ...transition, durationMs };
}

interface SceneLike {
  inMs: number;
  outMs: number;
  transition?: Transition | null;
}

/** Drops the first scene's transition and clamps the others to what their scenes allow. */
export function fitTransitions<T extends SceneLike>(scenes: T[]): T[] {
  const length = (scene: SceneLike) => scene.outMs - scene.inMs;
  return scenes.map((scene, i) => {
    if (!scene.transition) return scene;
    const transition = i === 0 ? null : fitTransition(scene.transition, length(scenes[i - 1]), length(scene));
    return transition === scene.transition ? scene : { ...scene, transition };
  });
}

/** CSS for one of the two video layers; the incoming scene is drawn on top. */
export interface LayerStyle {
  opacity: number;
  transform?: string;
  clipPath?: string;
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * How the outgoing (`from`) and incoming (`to`) scenes look at `progress` (0..1) through a transition.
 * Matches what ffmpeg's xfade filter of the same name renders.
 */
export function transitionStyles(type: TransitionType, progress: number): { from: LayerStyle; to: LayerStyle } {
  const p = clamp01(progress);
  switch (type) {
    case 'fade':
      return { from: { opacity: 1 }, to: { opacity: p } };
    case 'fadeblack':
      return { from: { opacity: clamp01(1 - 2 * p) }, to: { opacity: clamp01(2 * p - 1) } };
    case 'wipeleft':
      return { from: { opacity: 1 }, to: { opacity: 1, clipPath: `inset(0 0 0 ${pct(1 - p)})` } };
    case 'wiperight':
      return { from: { opacity: 1 }, to: { opacity: 1, clipPath: `inset(0 ${pct(1 - p)} 0 0)` } };
    case 'slideleft':
      return { from: { opacity: 1, transform: `translateX(-${pct(p)})` }, to: { opacity: 1, transform: `translateX(${pct(1 - p)})` } };
    case 'slideup':
      return { from: { opacity: 1, transform: `translateY(-${pct(p)})` }, to: { opacity: 1, transform: `translateY(${pct(1 - p)})` } };
  }
}

/** Sound levels of the two scenes during a transition: a dip for fade-through-black, a crossfade otherwise. */
export function transitionVolumes(type: TransitionType, progress: number): { from: number; to: number } {
  const p = clamp01(progress);
  if (type === 'fadeblack') return { from: clamp01(1 - 2 * p), to: clamp01(2 * p - 1) };
  return { from: 1 - p, to: p };
}
