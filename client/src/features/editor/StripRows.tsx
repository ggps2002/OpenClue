import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatTimecode } from '../../lib/format';
import { overlayLabel, type OverlayTrack } from './overlays';
import type { StripDragTarget } from './stripDrag';
import { clipLength, type AudioTrack } from './timelineDoc';

/** What the strip has selected; shared with the inspector. */
export type Selection =
  | { kind: 'scene'; id: string }
  | { kind: 'clip'; trackId: string; clipId: string }
  | { kind: 'overlay'; clipId: string }
  | { kind: 'zoom'; zoomId: string }
  | null;

export interface DragHandlers {
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}

export interface RowContext {
  total: number;
  selection: Selection;
  canEdit: boolean;
  onSelect(selection: Selection): void;
  /** Seeks to the clicked point of the lane (ignores the click that ends a drag). */
  seekFromLane(e: MouseEvent<HTMLElement>): void;
  isDragClick(): boolean;
  handlers(target: StripDragTarget): DragHandlers;
  playhead: ReactNode;
}

export const pct = (ms: number, total: number) => `${total === 0 ? 0 : (ms / total) * 100}%`;

/** Selecting a clip happens on press, so dragging an unselected clip selects it too. */
function pressable(ctx: RowContext, target: StripDragTarget, selection: Selection) {
  const h = ctx.handlers(target);
  return {
    ...h,
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (ctx.canEdit && e.button === 0) ctx.onSelect(selection);
      h.onPointerDown(e);
    },
    onClick(e: MouseEvent<HTMLElement>) {
      e.stopPropagation();
      if (ctx.isDragClick()) return;
      ctx.seekFromLane(e);
      ctx.onSelect(selection);
    },
  };
}

/** A grip on the edge of a strip item for trimming or resizing; arrow keys nudge it. */
export function EdgeHandle({ label, side, leftPct, valueMs, handlers }: { label: string; side: 'start' | 'end'; leftPct: string; valueMs: number; handlers: DragHandlers }) {
  return (
    <span
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuenow={Math.round(valueMs)}
      aria-valuetext={formatTimecode(valueMs)}
      title={`${label} (drag, or use the arrow keys)`}
      {...handlers}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute inset-y-1 z-[2] w-2 cursor-ew-resize touch-none rounded-sm bg-slate-900/25 hover:bg-slate-900/50 focus:bg-indigo-600 focus:outline-none',
        side === 'start' ? 'ml-0' : '-ml-2',
      )}
      style={{ left: leftPct }}
    />
  );
}

export function AudioRow({ track, ctx }: { track: AudioTrack; ctx: RowContext }) {
  return (
    <div data-lane className="relative h-9 rounded-lg bg-slate-100" onClick={ctx.seekFromLane}>
      {track.clips.map((clip) => {
        const selected = ctx.selection?.kind === 'clip' && ctx.selection.clipId === clip.id;
        return (
          <button
            key={clip.id}
            type="button"
            {...pressable(ctx, { kind: 'clip', trackId: track.id, clipId: clip.id }, { kind: 'clip', trackId: track.id, clipId: clip.id })}
            aria-pressed={selected}
            aria-label={`${track.name} clip at ${formatTimecode(clip.startMs)}`}
            className={cn(
              'absolute inset-y-1 touch-none overflow-hidden rounded-md border border-emerald-300 bg-emerald-100 px-2 text-left text-[10px] text-emerald-900',
              ctx.canEdit && 'cursor-grab',
              track.muted && 'opacity-50',
              selected && 'ring-2 ring-emerald-600',
            )}
            style={{ left: pct(clip.startMs, ctx.total), width: pct(clipLength(clip), ctx.total) }}
          >
            <span className="block truncate">{clip.source.type === 'voiceover' ? 'Voiceover' : 'Audio'}</span>
          </button>
        );
      })}
      {ctx.playhead}
    </div>
  );
}

export function OverlayRow({ track, ctx }: { track: OverlayTrack; ctx: RowContext }) {
  return (
    <div data-lane className="relative h-9 rounded-lg bg-slate-100" onClick={ctx.seekFromLane}>
      {track.clips.map((clip) => {
        const selected = ctx.selection?.kind === 'overlay' && ctx.selection.clipId === clip.id;
        const label = overlayLabel(clip);
        return (
          <div key={clip.id}>
            <button
              type="button"
              {...pressable(ctx, { kind: 'clip', trackId: track.id, clipId: clip.id }, { kind: 'overlay', clipId: clip.id })}
              aria-pressed={selected}
              aria-label={`${label} overlay at ${formatTimecode(clip.startMs)}`}
              className={cn(
                'absolute inset-y-1 touch-none overflow-hidden rounded-md border border-amber-300 bg-amber-100 px-2 text-left text-[10px] text-amber-900',
                ctx.canEdit && 'cursor-grab',
                track.hidden && 'opacity-50',
                selected && 'ring-2 ring-amber-600',
              )}
              style={{ left: pct(clip.startMs, ctx.total), width: pct(clip.durationMs, ctx.total) }}
            >
              <span className="block truncate">{label}</span>
              {clip.keyframes.map((k) => (
                <span
                  key={k.t}
                  aria-hidden
                  className="absolute bottom-0.5 h-1.5 w-1.5 -translate-x-1/2 rotate-45 bg-amber-600"
                  style={{ left: pct(k.t, clip.durationMs) }}
                />
              ))}
            </button>
            {ctx.canEdit && selected && (
              <EdgeHandle
                label={`Length of ${label} overlay`}
                side="end"
                leftPct={pct(clip.startMs + clip.durationMs, ctx.total)}
                valueMs={clip.durationMs}
                handlers={ctx.handlers({ kind: 'overlay-end', clipId: clip.id })}
              />
            )}
          </div>
        );
      })}
      {ctx.playhead}
    </div>
  );
}
