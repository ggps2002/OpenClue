import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../../lib/cn';
import type { Timeline } from './Timeline';
import { frameToVideo, SPOTLIGHT_RADIUS, FRAME_ASPECT, videoToFrame, zoomWindow } from './zooms';

interface ZoomFramingProps {
  timeline: Timeline;
  timeMs: number;
  zoomId: string;
  /** Picture width/height of the video on screen. */
  aspect: number;
  canEdit: boolean;
  /** Called once a drag or nudge ends, with the new focus in source-picture fractions. */
  onMove(zoomId: string, focus: { x: number; y: number }): void;
}

const NUDGE = 0.01;

/**
 * While a zoom is selected the preview shows its scene unzoomed, with the area the zoom will fill the
 * frame with outlined. Dragging the outline (or the arrow keys) moves the zoom's focus point.
 */
export function ZoomFraming({ timeline, timeMs, zoomId, aspect, canEdit, onMove }: ZoomFramingProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const found = timeline.zoom(zoomId);
  const onScreen = timeline.sceneAt(timeMs);
  if (!found || onScreen?.scene.id !== found.scene.id) return null;

  const { zoom } = found;
  const focus = drag ?? videoToFrame(zoom, aspect);
  const view = zoomWindow(focus, zoom.scale);

  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Drag from the visible window centre, so a focus pulled in from the edge moves right away.
    setDrag({ pointerX: e.clientX, pointerY: e.clientY, x: view.x, y: view.y });
  };
  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width === 0) return;
    setDrag({
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: drag.x + (e.clientX - drag.pointerX) / rect.width,
      y: drag.y + (e.clientY - drag.pointerY) / rect.height,
    });
  };
  const pointerUp = () => {
    if (drag) onMove(zoom.id, frameToVideo(drag, aspect));
    setDrag(null);
  };
  const keyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key];
    if (!delta || !canEdit) return;
    e.preventDefault();
    onMove(zoom.id, frameToVideo({ x: view.x + delta[0], y: view.y + delta[1] }, aspect));
  };

  const radius = SPOTLIGHT_RADIUS;
  return (
    <div ref={frame} className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="zoom-framing">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Zoom area (${Math.round(zoom.scale * 100)}%). Drag or use the arrow keys to move it.`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={keyDown}
        className={cn('pointer-events-auto absolute touch-none rounded-sm border-2 border-violet-400 outline-none select-none focus-visible:ring-2 focus-visible:ring-white', canEdit && 'cursor-move')}
        style={{
          left: `${(view.x - view.size / 2) * 100}%`,
          top: `${(view.y - view.size / 2) * 100}%`,
          width: `${view.size * 100}%`,
          height: `${view.size * 100}%`,
          boxShadow: '0 0 0 100vmax rgba(15, 23, 42, 0.45)',
        }}
      />
      <span
        aria-hidden
        className={cn('absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed', zoom.spotlight ? 'border-amber-300' : 'border-violet-300/70')}
        style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%`, width: `${radius * 200}%`, height: `${radius * 200 * FRAME_ASPECT}%` }}
      />
    </div>
  );
}
