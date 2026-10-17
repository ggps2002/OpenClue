import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '../../lib/cn';
import { overlayLabel, valuesAt, type OverlayClip, type OverlayValues } from './overlays';
import type { Timeline } from './Timeline';

interface OverlayLayerProps {
  timeline: Timeline;
  timeMs: number;
  imageUrls: Map<string, string>;
  selectedId: string | null;
  canEdit: boolean;
  onSelect(clipId: string): void;
  /** Called once a drag or nudge ends, with the new position at `localMs` into the overlay. */
  onMove(clipId: string, localMs: number, position: Pick<OverlayValues, 'x' | 'y'>): void;
}

const NUDGE = 0.01;

/**
 * Draws the overlays showing at `timeMs` over the preview, positioned in the 16:9 frame. Sizes use
 * container query units so text scales with the player. Editors can drag an overlay (or nudge it with
 * the arrow keys) to set its position at the playhead.
 */
export function OverlayLayer({ timeline, timeMs, imageUrls, selectedId, canEdit, onSelect, onMove }: OverlayLayerProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ clipId: string; pointerX: number; pointerY: number; x: number; y: number; moved: boolean } | null>(null);
  const showing = timeline.overlaysAt(timeMs).filter(({ track }) => !track.hidden);

  const pointerDown = (clip: OverlayClip, values: OverlayValues) => (e: PointerEvent<HTMLDivElement>) => {
    onSelect(clip.id);
    if (!canEdit) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ clipId: clip.id, pointerX: e.clientX, pointerY: e.clientY, x: values.x, y: values.y, moved: false });
  };

  const pointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width === 0) return;
    setDrag({
      ...drag,
      pointerX: e.clientX,
      pointerY: e.clientY,
      x: drag.x + (e.clientX - drag.pointerX) / rect.width,
      y: drag.y + (e.clientY - drag.pointerY) / rect.height,
      moved: true,
    });
  };

  const pointerUp = (clip: OverlayClip) => () => {
    if (drag?.moved) onMove(clip.id, timeMs - clip.startMs, { x: drag.x, y: drag.y });
    setDrag(null);
  };

  const keyDown = (clip: OverlayClip, values: OverlayValues) => (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key];
    if (!delta || !canEdit) return;
    e.preventDefault();
    onMove(clip.id, timeMs - clip.startMs, { x: values.x + delta[0], y: values.y + delta[1] });
  };

  return (
    <div ref={frame} className="pointer-events-none absolute inset-0 overflow-hidden" style={{ containerType: 'size' }} data-testid="overlay-layer">
      {showing.map(({ clip, localMs }) => {
        const animated = valuesAt(clip, localMs);
        const values = drag?.clipId === clip.id ? { ...animated, x: drag.x, y: drag.y } : animated;
        const selected = clip.id === selectedId;
        return (
          <div
            key={clip.id}
            role="button"
            tabIndex={0}
            aria-label={`Overlay: ${overlayLabel(clip)}`}
            aria-pressed={selected}
            onPointerDown={pointerDown(clip, values)}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp(clip)}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={keyDown(clip, values)}
            onFocus={() => onSelect(clip.id)}
            className={cn(
              'pointer-events-auto absolute touch-none outline-none select-none',
              canEdit && 'cursor-move',
              selected && 'ring-2 ring-indigo-400 ring-offset-1 ring-offset-transparent',
            )}
            style={{
              left: `${values.x * 100}%`,
              top: `${values.y * 100}%`,
              width: `${clip.width * 100}%`,
              height: `${clip.height * 100}%`,
              opacity: values.opacity,
              transform: `translate(-50%, -50%) scale(${values.scale})`,
            }}
          >
            <OverlayContentView clip={clip} imageUrls={imageUrls} />
          </div>
        );
      })}
    </div>
  );
}

function OverlayContentView({ clip, imageUrls }: { clip: OverlayClip; imageUrls: Map<string, string> }) {
  const { content } = clip;
  if (content.type === 'text') {
    const style: CSSProperties = {
      color: content.color,
      background: content.background ?? undefined,
      fontSize: `${content.fontSize * 100}cqh`,
      fontWeight: content.bold ? 700 : 400,
      textAlign: content.align,
      justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[content.align],
      padding: '0 1.5cqh',
      borderRadius: '1cqh',
    };
    return (
      <div className="flex h-full w-full items-center leading-tight break-words whitespace-pre-wrap" style={style}>
        <span className="w-full">{content.text}</span>
      </div>
    );
  }
  if (content.type === 'shape') {
    return (
      <div
        className="h-full w-full"
        style={{
          background: content.fill ?? 'transparent',
          border: content.stroke ? `0.6cqh solid ${content.stroke}` : undefined,
          borderRadius: content.shape === 'ellipse' ? '50%' : '0.8cqh',
        }}
      />
    );
  }
  const url = imageUrls.get(content.mediaId);
  return url ? (
    <img src={url} alt="" draggable={false} className="h-full w-full object-contain" />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-red-500/30 text-xs text-white">Image missing</div>
  );
}
