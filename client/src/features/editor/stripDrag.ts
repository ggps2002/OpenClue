import { setDuration } from './overlays';
import type { Timeline } from './Timeline';
import { clipLength } from './timelineDoc';
import { MIN_ZOOM_MS, zoomEnd } from './zooms';

/** Something on the timeline strip that can be dragged (or nudged with the arrow keys). */
export type StripDragTarget =
  | { kind: 'scene-in' | 'scene-out'; sceneId: string }
  | { kind: 'clip'; trackId: string; clipId: string }
  | { kind: 'overlay-end'; clipId: string }
  | { kind: 'zoom' | 'zoom-end'; zoomId: string };

/** How far the strip lets you zoom in, and the steps the buttons go through. */
export const STRIP_ZOOMS = [1, 2, 4, 8, 16, 32];
/** Arrow-key nudge, and the bigger one with Shift. */
export const NUDGE_MS = 100;
export const BIG_NUDGE_MS = 1000;

/**
 * The timeline with `target` dragged by `deltaMs`. Always applied to the timeline as it was when the
 * drag started, so dragging past a limit and back restores the original. `sourceMs` gives each
 * source video's length (unknown lengths don't limit trims).
 */
export function applyStripDrag(timeline: Timeline, target: StripDragTarget, deltaMs: number, sourceMs: (mediaId: string) => number | undefined): Timeline {
  const delta = Math.round(deltaMs);
  switch (target.kind) {
    case 'scene-in':
    case 'scene-out': {
      const scene = timeline.scene(target.sceneId);
      if (!scene) return timeline;
      const max = sourceMs(scene.mediaId) ?? Infinity;
      const points = target.kind === 'scene-in' ? { inMs: scene.inMs + delta } : { outMs: scene.outMs + delta };
      return timeline.trimScene(scene.id, points, max);
    }
    case 'clip': {
      const track = timeline.tracks.find((t) => t.id === target.trackId);
      const clip = track?.clips.find((c) => c.id === target.clipId);
      return clip ? timeline.moveClip(target.trackId, target.clipId, clip.startMs + delta) : timeline;
    }
    case 'overlay-end': {
      const clip = timeline.overlay(target.clipId)?.clip;
      return clip ? timeline.updateOverlay(clip.id, (c) => setDuration(c, c.durationMs + delta)) : timeline;
    }
    case 'zoom':
    case 'zoom-end': {
      const found = timeline.zoom(target.zoomId);
      if (!found) return timeline;
      const { scene, zoom } = found;
      const max = sourceMs(scene.mediaId);
      if (target.kind === 'zoom-end') return timeline.updateZoom(zoom.id, { durationMs: Math.max(MIN_ZOOM_MS, zoom.durationMs + delta) }, max);
      // A move keeps the zoom's length, so it stops at its neighbours instead of shrinking against them.
      const zooms = scene.zooms ?? [];
      const index = zooms.findIndex((z) => z.id === zoom.id);
      const previousEnd = index > 0 ? zoomEnd(zooms[index - 1]) : 0;
      const nextStart = Math.min(zooms[index + 1]?.startMs ?? Infinity, max ?? Infinity);
      const startMs = Math.max(previousEnd, Math.min(nextStart - zoom.durationMs, zoom.startMs + delta));
      return timeline.updateZoom(zoom.id, { startMs }, max);
    }
  }
}

/** The timeline times of the target's edges that move with a drag, used for snapping. */
export function draggedEdges(timeline: Timeline, target: StripDragTarget): number[] {
  switch (target.kind) {
    case 'scene-in':
      // Trimming the start ripples the scene into place, so its left edge on the strip doesn't move.
      return [];
    case 'scene-out': {
      const placed = timeline.placement(target.sceneId);
      return placed ? [placed.endMs] : [];
    }
    case 'clip': {
      const track = timeline.tracks.find((t) => t.id === target.trackId);
      if (track?.kind === 'audio') {
        const clip = track.clips.find((c) => c.id === target.clipId);
        return clip ? [clip.startMs, clip.startMs + clipLength(clip)] : [];
      }
      const clip = track?.clips.find((c) => c.id === target.clipId);
      return clip ? [clip.startMs, clip.startMs + clip.durationMs] : [];
    }
    case 'overlay-end': {
      const clip = timeline.overlay(target.clipId)?.clip;
      return clip ? [clip.startMs + clip.durationMs] : [];
    }
    case 'zoom':
    case 'zoom-end': {
      const found = timeline.zoom(target.zoomId);
      const placed = found && timeline.placement(found.scene.id);
      if (!found || !placed) return [];
      const toTimeline = (sourceMs: number) => placed.startMs + sourceMs - found.scene.inMs;
      const end = toTimeline(zoomEnd(found.zoom));
      return target.kind === 'zoom' ? [toTimeline(found.zoom.startMs), end] : [end];
    }
  }
}

/** Where dragged edges like to land: the start, the playhead and every scene boundary. */
export function snapPoints(timeline: Timeline, playheadMs: number): number[] {
  return [0, playheadMs, ...timeline.placements().flatMap((p) => [p.startMs, p.endMs])];
}

/**
 * Adjusts a drag so the dragged edge closest to a snap point lands on it, when within `toleranceMs`.
 * Returns the delta unchanged when nothing is close enough.
 */
export function snapDelta(deltaMs: number, edges: number[], points: number[], toleranceMs: number): number {
  let best: { distance: number; delta: number } | null = null;
  for (const edge of edges) {
    for (const point of points) {
      const distance = Math.abs(edge + deltaMs - point);
      if (distance <= toleranceMs && (!best || distance < best.distance)) best = { distance, delta: point - edge };
    }
  }
  return best ? best.delta : deltaMs;
}

/** The ruler step that gives roughly 5–10 ticks across `visibleMs`. */
export function tickStep(visibleMs: number): number {
  const steps = [500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
  return steps.find((s) => visibleMs / s <= 10) ?? 1_200_000;
}
