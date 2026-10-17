/**
 * Zoom/spotlight effects and their maths. Mirrors the zoom part of server/src/modules/timelines/timelines.schema.ts.
 * Zooms belong to a scene and use its source video's clock and picture, the same space as recorded clicks.
 */

export interface Zoom {
  id: string;
  /** Source-video time. */
  startMs: number;
  durationMs: number;
  /** Focus point as fractions of the source video's picture. */
  x: number;
  y: number;
  scale: number;
  /** Dims everything around the focus point. */
  spotlight: boolean;
}

export interface Click {
  t: number;
  x: number;
  y: number;
}

export const MIN_ZOOM_MS = 500;
export const DEFAULT_ZOOM_MS = 2500;
export const MAX_ZOOM_SCALE = 4;
export const DEFAULT_ZOOM_SCALE = 1.8;
/** Time spent easing in (and out) of a zoom, at most a third of its length. */
export const ZOOM_RAMP_MS = 600;
/** Output frame width / height, shared with overlays and the render. */
export const FRAME_ASPECT = 16 / 9;
/** Spotlight radius as a fraction of the frame width, before zooming. */
export const SPOTLIGHT_RADIUS = 0.1;
export const SPOTLIGHT_DIM = 0.55;

/** Auto-zoom tuning: how clicks are grouped and how long the camera stays on them. */
const LEAD_MS = 700;
const HOLD_MS = 1500;
const GROUP_GAP_MS = 2000;
const GROUP_DISTANCE = 0.2;
const WIDE_GROUP = 0.25;

/** A zoom's effect at one moment; `strength` eases from 0 to 1 and back. */
export interface ZoomView {
  zoomId: string;
  x: number;
  y: number;
  /** Current magnification (1 = none). */
  scale: number;
  /** Spotlight strength 0..1 (0 when the zoom has none). */
  spotlight: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const smoothstep = (p: number) => p * p * (3 - 2 * p);

export const zoomEnd = (zoom: Pick<Zoom, 'startMs' | 'durationMs'>) => zoom.startMs + zoom.durationMs;

/** The zoom effect at `sourceMs`, or null when no zoom is active. */
export function zoomAt(zooms: Zoom[] | undefined, sourceMs: number): ZoomView | null {
  const zoom = zooms?.find((z) => sourceMs >= z.startMs && sourceMs < zoomEnd(z));
  if (!zoom) return null;
  const ramp = Math.min(ZOOM_RAMP_MS, zoom.durationMs / 3);
  const local = sourceMs - zoom.startMs;
  const strength = smoothstep(clamp(Math.min(local, zoom.durationMs - local) / ramp, 0, 1));
  return {
    zoomId: zoom.id,
    x: zoom.x,
    y: zoom.y,
    scale: 1 + (zoom.scale - 1) * strength,
    spotlight: zoom.spotlight ? strength : 0,
  };
}

/** Where a video of `videoAspect` (width/height) sits inside the 16:9 frame when letterboxed. */
function contentBox(videoAspect: number) {
  const aspect = Number.isFinite(videoAspect) && videoAspect > 0 ? videoAspect : FRAME_ASPECT;
  if (aspect >= FRAME_ASPECT) {
    const height = FRAME_ASPECT / aspect;
    return { left: 0, top: (1 - height) / 2, width: 1, height };
  }
  const width = aspect / FRAME_ASPECT;
  return { left: (1 - width) / 2, top: 0, width, height: 1 };
}

/** A point of the source picture in frame fractions. */
export function videoToFrame(point: { x: number; y: number }, videoAspect: number): { x: number; y: number } {
  const box = contentBox(videoAspect);
  return { x: box.left + point.x * box.width, y: box.top + point.y * box.height };
}

/** A frame point back in source-picture fractions, clamped to the picture. */
export function frameToVideo(point: { x: number; y: number }, videoAspect: number): { x: number; y: number } {
  const box = contentBox(videoAspect);
  return { x: round3(clamp((point.x - box.left) / box.width, 0, 1)), y: round3(clamp((point.y - box.top) / box.height, 0, 1)) };
}

/**
 * The part of the frame shown at `scale` when centring on `focus` (frame fractions): the centre is
 * pulled in so the view never leaves the frame. At scale 1 it is the whole frame.
 */
export function zoomWindow(focus: { x: number; y: number }, scale: number): { x: number; y: number; size: number } {
  const half = 1 / (2 * scale);
  return { x: clamp(focus.x, half, 1 - half), y: clamp(focus.y, half, 1 - half), size: 1 / scale };
}

/**
 * CSS for a zoomed video layer and its spotlight. The layer is scaled from its top-left corner and
 * moved so the zoom window fills the frame; `spotlight` is where the focus ends up on screen.
 */
export function zoomStyles(view: ZoomView, videoAspect: number) {
  const focus = videoToFrame(view, videoAspect);
  const window = zoomWindow(focus, view.scale);
  const tx = 0.5 - view.scale * window.x;
  const ty = 0.5 - view.scale * window.y;
  return {
    transform: `translate(${(tx * 100).toFixed(3)}%, ${(ty * 100).toFixed(3)}%) scale(${view.scale.toFixed(4)})`,
    spotlight: { x: tx + view.scale * focus.x, y: ty + view.scale * focus.y, radius: SPOTLIGHT_RADIUS * view.scale, dim: SPOTLIGHT_DIM * view.spotlight },
  };
}

/** A radial gradient that darkens the frame outside a circle around the spotlight point. */
export function spotlightBackground(spot: ReturnType<typeof zoomStyles>['spotlight']): string {
  const rx = spot.radius * 100;
  const ry = spot.radius * FRAME_ASPECT * 100;
  return `radial-gradient(ellipse ${rx.toFixed(2)}% ${ry.toFixed(2)}% at ${(spot.x * 100).toFixed(2)}% ${(spot.y * 100).toFixed(2)}%, transparent 80%, rgba(0, 0, 0, ${spot.dim.toFixed(3)}) 100%)`;
}

/**
 * Turns recorded clicks inside `range` (source time) into zooms: clicks close in time and place share one
 * zoom, which starts a little before the first click and holds after the last. Neighbouring zooms that
 * would overlap meet halfway between them; anything left too short is dropped.
 */
export function zoomsFromClicks(clicks: Click[], range: { inMs: number; outMs: number }, createId: () => string): Zoom[] {
  const inside = clicks.filter((c) => c.t >= range.inMs && c.t <= range.outMs).sort((a, b) => a.t - b.t);
  const groups: Click[][] = [];
  for (const click of inside) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    if (group && last && click.t - last.t <= GROUP_GAP_MS && Math.hypot(click.x - mean(group, 'x'), click.y - mean(group, 'y')) <= GROUP_DISTANCE) {
      group.push(click);
    } else {
      groups.push([click]);
    }
  }

  const zooms: Zoom[] = [];
  for (const group of groups) {
    let startMs = Math.max(range.inMs, group[0].t - LEAD_MS);
    const endMs = Math.min(range.outMs, group[group.length - 1].t + HOLD_MS);
    const previous = zooms.at(-1);
    const overlaps = previous !== undefined && startMs < zoomEnd(previous);
    if (overlaps) startMs = Math.round(Math.max(previous.startMs + MIN_ZOOM_MS, (zoomEnd(previous) + startMs) / 2));
    if (endMs - startMs < MIN_ZOOM_MS) continue;
    if (overlaps) previous.durationMs = startMs - previous.startMs;
    const spread = Math.max(...group.map((c) => c.x)) - Math.min(...group.map((c) => c.x)) + Math.max(...group.map((c) => c.y)) - Math.min(...group.map((c) => c.y));
    zooms.push({
      id: createId(),
      startMs: Math.round(startMs),
      durationMs: Math.round(endMs - startMs),
      x: round3(mean(group, 'x')),
      y: round3(mean(group, 'y')),
      scale: spread > WIDE_GROUP ? 1.4 : DEFAULT_ZOOM_SCALE,
      spotlight: false,
    });
  }
  return zooms;
}

function mean(clicks: Click[], key: 'x' | 'y'): number {
  return clicks.reduce((sum, c) => sum + c[key], 0) / clicks.length;
}

/** Room for a new zoom at `sourceMs` within `range`, up to the next zoom; null when there isn't enough. */
export function zoomSlotAt(zooms: Zoom[], sourceMs: number, range: { inMs: number; outMs: number }): { startMs: number; durationMs: number } | null {
  if (zooms.some((z) => sourceMs >= z.startMs && sourceMs < zoomEnd(z))) return null;
  const next = zooms.find((z) => z.startMs > sourceMs);
  const startMs = Math.round(sourceMs);
  const durationMs = Math.round(Math.min(DEFAULT_ZOOM_MS, (next?.startMs ?? Infinity) - startMs, range.outMs - startMs));
  return durationMs >= MIN_ZOOM_MS ? { startMs, durationMs } : null;
}

/**
 * Applies changes to one zoom, keeping zooms in order and apart: its start stays between its neighbours
 * and its length stops at the next one. Values are clamped to what the schema allows.
 */
export function updateZoom(zooms: Zoom[], zoomId: string, changes: Partial<Omit<Zoom, 'id'>>, sourceDurationMs = Infinity): Zoom[] {
  const index = zooms.findIndex((z) => z.id === zoomId);
  if (index === -1) return zooms;
  const zoom = { ...zooms[index], ...changes };
  const previousEnd = index > 0 ? zoomEnd(zooms[index - 1]) : 0;
  const nextStart = Math.min(zooms[index + 1]?.startMs ?? Infinity, sourceDurationMs);
  const startMs = Math.round(clamp(zoom.startMs, previousEnd, Math.max(previousEnd, nextStart - MIN_ZOOM_MS)));
  const durationMs = Math.round(clamp(zoom.durationMs, MIN_ZOOM_MS, Math.max(MIN_ZOOM_MS, nextStart - startMs)));
  const updated: Zoom = {
    ...zoom,
    startMs,
    durationMs,
    x: round3(clamp(zoom.x, 0, 1)),
    y: round3(clamp(zoom.y, 0, 1)),
    scale: round3(clamp(zoom.scale, 1, MAX_ZOOM_SCALE)),
  };
  return zooms.map((z, i) => (i === index ? updated : z));
}

/** Splits a scene's zooms at `sourceMs`: zooms spanning the cut go to both halves (the copy gets a new id). */
export function splitZooms(zooms: Zoom[] | undefined, sourceMs: number, createId: () => string): [Zoom[] | undefined, Zoom[] | undefined] {
  if (!zooms) return [undefined, undefined];
  const first = zooms.filter((z) => z.startMs < sourceMs);
  const second = zooms.filter((z) => zoomEnd(z) > sourceMs).map((z) => (z.startMs < sourceMs ? { ...z, id: createId() } : z));
  return [first, second];
}
