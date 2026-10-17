import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Timeline } from './Timeline';
import { applyStripDrag, BIG_NUDGE_MS, draggedEdges, NUDGE_MS, snapDelta, snapPoints, type StripDragTarget } from './stripDrag';

/** Pointer travel before a press becomes a drag, and how close (in px) an edge must come to snap. */
const DRAG_THRESHOLD_PX = 3;
const SNAP_PX = 8;
/** A click this soon after a drag ends is the release of that drag. */
const CLICK_AFTER_DRAG_MS = 250;

interface DragState {
  target: StripDragTarget;
  pointerX: number;
  msPerPx: number;
  deltaMs: number;
  moved: boolean;
}

interface Options {
  timeline: Timeline;
  /** Milliseconds shown across the full lane width. */
  totalMs: number;
  playheadMs: number;
  canEdit: boolean;
  sourceMs(mediaId: string): number | undefined;
  onEdit(edit: (timeline: Timeline) => Timeline): void;
}

/**
 * Pointer and keyboard dragging on the timeline strip. While a drag is in progress `display` is the
 * timeline as it would be after dropping; the edit is applied once, on release, so a drag is one undo step.
 * Edges snap to the playhead and scene boundaries (hold Alt to drag freely).
 */
export function useStripDrag({ timeline, totalMs, playheadMs, canEdit, sourceMs, onEdit }: Options) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragEndedAt = useRef(-Infinity);

  const display = useMemo(
    () => (drag?.moved ? applyStripDrag(timeline, drag.target, drag.deltaMs, sourceMs) : timeline),
    [drag, timeline, sourceMs],
  );

  const handlers = useCallback(
    (target: StripDragTarget) => ({
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (!canEdit || e.button !== 0) return;
        const lane = e.currentTarget.closest<HTMLElement>('[data-lane]');
        const width = lane?.getBoundingClientRect().width ?? 0;
        if (width <= 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({ target, pointerX: e.clientX, msPerPx: totalMs / width, deltaMs: 0, moved: false });
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        setDrag((d) => {
          if (!d) return d;
          const dx = e.clientX - d.pointerX;
          if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return d;
          const raw = dx * d.msPerPx;
          const deltaMs = e.altKey
            ? raw
            : snapDelta(raw, draggedEdges(timeline, d.target), snapPoints(timeline, playheadMs), SNAP_PX * d.msPerPx);
          return { ...d, deltaMs, moved: true };
        });
      },
      onPointerUp() {
        if (drag?.moved) {
          const { target: dragged, deltaMs } = drag;
          dragEndedAt.current = performance.now();
          onEdit((t) => applyStripDrag(t, dragged, deltaMs, sourceMs));
        }
        setDrag(null);
      },
      onPointerCancel() {
        setDrag(null);
      },
      onKeyDown(e: KeyboardEvent<HTMLElement>) {
        if (!canEdit || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        e.stopPropagation();
        const step = (e.shiftKey ? BIG_NUDGE_MS : NUDGE_MS) * (e.key === 'ArrowLeft' ? -1 : 1);
        onEdit((t) => applyStripDrag(t, target, step, sourceMs));
      },
    }),
    [canEdit, drag, onEdit, playheadMs, sourceMs, timeline, totalMs],
  );

  /** True for the click that follows a drag's release, so it doesn't also select or seek. */
  const isDragClick = useCallback(() => performance.now() - dragEndedAt.current < CLICK_AFTER_DRAG_MS, []);

  return { display, dragging: drag?.moved ? drag.target : null, handlers, isDragClick };
}
