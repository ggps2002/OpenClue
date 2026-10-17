import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { cn } from '../../lib/cn';
import { formatDuration, formatTimecode } from '../../lib/format';
import { AudioRow, EdgeHandle, OverlayRow, pct, type RowContext, type Selection } from './StripRows';
import { STRIP_ZOOMS, tickStep } from './stripDrag';
import { TRANSITION_LABELS } from './transitions';
import type { Timeline } from './Timeline';
import { clipLength } from './timelineDoc';
import { useStripDrag } from './useStripDrag';
import { zoomEnd } from './zooms';
import type { TimelineSource } from './timeline.api';

export type { Selection } from './StripRows';

interface TimelineStripProps {
  timeline: Timeline;
  sources: TimelineSource[];
  timeMs: number;
  selection: Selection;
  canEdit: boolean;
  onSelect(selection: Selection): void;
  onSeek(timeMs: number): void;
  onMoveScene(sceneId: string, toIndex: number): void;
  /** Applies a drag or nudge made on the strip as one undoable edit. */
  onEdit(edit: (timeline: Timeline) => Timeline): void;
}

/**
 * The track view: a ruler, the scene row and one row per audio/overlay track, all sharing one time scale.
 * Zooming in widens the lanes inside a horizontal scroller; the playhead is kept in view.
 */
export function TimelineStrip(props: TimelineStripProps) {
  const { timeline, sources, timeMs, selection, canEdit, onSelect, onSeek, onMoveScene, onEdit } = props;
  const [reordering, setReordering] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const sourceMs = useCallback((mediaId: string) => sources.find((s) => s.id === mediaId)?.durationMs ?? undefined, [sources]);
  // The scale comes from the timeline before any drag, so the strip doesn't rescale under the pointer.
  const total = Math.max(timeline.durationMs, 1000);
  const drag = useStripDrag({ timeline, totalMs: total, playheadMs: timeMs, canEdit, sourceMs, onEdit });
  const shown = drag.display;
  const step = tickStep(total / zoom);
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  // Keep the playhead on screen while playing or seeking, and centre it when the zoom changes.
  const lastZoom = useRef(zoom);
  useEffect(() => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const x = (timeMs / total) * el.scrollWidth;
    if (lastZoom.current !== zoom) {
      lastZoom.current = zoom;
      el.scrollLeft = x - el.clientWidth / 2;
    } else if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = x - el.clientWidth * 0.1;
    }
  }, [timeMs, total, zoom]);

  /** Seeks to where the lane was clicked. */
  const seekFromLane = (e: MouseEvent<HTMLElement>) => {
    if (drag.isDragClick()) return;
    const lane = e.currentTarget.closest<HTMLElement>('[data-lane]') ?? e.currentTarget;
    const rect = lane.getBoundingClientRect();
    if (rect.width > 0) onSeek(((e.clientX - rect.left) / rect.width) * total);
  };

  const drop = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (reordering) onMoveScene(reordering, index);
    setReordering(null);
  };

  const playhead = (
    <div className="pointer-events-none absolute inset-y-0 z-[3] w-0.5 bg-rose-500" style={{ left: pct(timeMs, total) }} />
  );
  const ctx: RowContext = { total, selection, canEdit, onSelect, seekFromLane, isDragClick: drag.isDragClick, handlers: drag.handlers, playhead };
  const zoomIndex = STRIP_ZOOMS.indexOf(zoom);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Timeline">
      <div className="mb-2 flex items-center justify-end gap-1 text-xs text-slate-600">
        <span className="mr-1">Zoom</span>
        <ZoomButton label="Zoom timeline out" disabled={zoomIndex <= 0} onClick={() => setZoom(STRIP_ZOOMS[zoomIndex - 1])}>
          −
        </ZoomButton>
        <span className="w-12 text-center tabular-nums" aria-live="polite" aria-label={`Timeline zoom ${zoom * 100}%`}>
          {zoom * 100}%
        </span>
        <ZoomButton label="Zoom timeline in" disabled={zoomIndex >= STRIP_ZOOMS.length - 1} onClick={() => setZoom(STRIP_ZOOMS[zoomIndex + 1])}>
          +
        </ZoomButton>
        <button type="button" className="ml-1 rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40" disabled={zoom === 1} onClick={() => setZoom(1)}>
          Fit
        </button>
      </div>
      <div className="flex gap-3">
        <div className="flex w-[6.5rem] shrink-0 flex-col gap-2 text-xs font-semibold text-slate-700">
          <div className="h-5" />
          <div className="flex h-14 items-center">Scenes</div>
          {shown.tracks.map((track) => (
            <div key={track.id} className="flex h-9 items-center truncate">
              <span className="truncate">{track.name}</span>
              {track.kind === 'audio' && track.muted && <span className="ml-1 font-normal text-slate-400">(muted)</span>}
              {track.kind === 'overlay' && track.hidden && <span className="ml-1 font-normal text-slate-400">(hidden)</span>}
            </div>
          ))}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pb-1" data-testid="timeline-scroller">
          <div className="flex flex-col gap-2" style={{ width: `${zoom * 100}%` }}>
            <div data-lane className="relative h-5 cursor-pointer text-[10px] text-slate-500" onClick={seekFromLane}>
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 -translate-x-1/2 whitespace-nowrap first:translate-x-0" style={{ left: pct(t, total) }}>
                  {step < 1000 ? formatTimecode(t) : formatDuration(t)}
                </span>
              ))}
              {playhead}
            </div>

            <div data-lane className="relative h-14 rounded-lg bg-slate-100" onClick={seekFromLane}>
              {shown.placements().map(({ scene, index, startMs, endMs }) => {
                const selected = selection?.kind === 'scene' && selection.id === scene.id;
                const missing = !names.has(scene.mediaId);
                const name = scene.name || `Scene ${index + 1}`;
                return (
                  <div key={scene.id}>
                    <button
                      type="button"
                      draggable={canEdit}
                      onDragStart={() => setReordering(scene.id)}
                      onDragEnd={() => setReordering(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={drop(index)}
                      onClick={(e) => {
                        e.stopPropagation();
                        seekFromLane(e);
                        onSelect({ kind: 'scene', id: scene.id });
                      }}
                      aria-pressed={selected}
                      aria-label={`${name}, ${formatTimecode(clipLength(scene))}`}
                      className={cn(
                        'absolute inset-y-1 overflow-hidden rounded-md border px-3 text-left text-xs',
                        missing ? 'border-red-300 bg-red-100 text-red-800' : 'border-indigo-300 bg-indigo-100 text-indigo-900',
                        selected && 'ring-2 ring-indigo-600',
                        reordering === scene.id && 'opacity-50',
                      )}
                      style={{ left: pct(startMs, total), width: pct(clipLength(scene), total) }}
                    >
                      <span className="block truncate font-medium">{name}</span>
                      <span className="block truncate text-[10px] opacity-75">{missing ? 'Source missing' : names.get(scene.mediaId)}</span>
                    </button>
                    {canEdit && (
                      <>
                        <EdgeHandle label={`Trim start of ${name}`} side="start" leftPct={pct(startMs, total)} valueMs={scene.inMs} handlers={drag.handlers({ kind: 'scene-in', sceneId: scene.id })} />
                        <EdgeHandle label={`Trim end of ${name}`} side="end" leftPct={pct(endMs, total)} valueMs={scene.outMs} handlers={drag.handlers({ kind: 'scene-out', sceneId: scene.id })} />
                      </>
                    )}
                  </div>
                );
              })}
              {shown.placements().map(({ scene, startMs }) =>
                scene.transition ? (
                  <span
                    key={`transition-${scene.id}`}
                    title={`${TRANSITION_LABELS[scene.transition.type]}, ${formatTimecode(scene.transition.durationMs)}`}
                    role="img"
                    aria-label={`${TRANSITION_LABELS[scene.transition.type]} into ${scene.name || 'scene'}`}
                    className="pointer-events-none absolute inset-y-3 rounded bg-gradient-to-r from-indigo-500/10 via-indigo-500/60 to-indigo-500/10 ring-1 ring-indigo-500"
                    style={{ left: pct(startMs, total), width: pct(scene.transition.durationMs, total) }}
                  />
                ) : null,
              )}
              {shown.placements().flatMap(({ scene, startMs, endMs }) =>
                shown.visibleZooms(scene).map((zoomFx) => {
                  const from = Math.max(startMs, startMs + zoomFx.startMs - scene.inMs);
                  const to = Math.min(endMs, startMs + zoomEnd(zoomFx) - scene.inMs);
                  const selected = selection?.kind === 'zoom' && selection.zoomId === zoomFx.id;
                  const zoomHandlers = drag.handlers({ kind: 'zoom', zoomId: zoomFx.id });
                  return (
                    <div key={zoomFx.id}>
                      <button
                        type="button"
                        {...zoomHandlers}
                        onPointerDown={(e) => {
                          if (canEdit && e.button === 0) onSelect({ kind: 'zoom', zoomId: zoomFx.id });
                          zoomHandlers.onPointerDown(e);
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (drag.isDragClick()) return;
                          seekFromLane(e);
                          onSelect({ kind: 'zoom', zoomId: zoomFx.id });
                        }}
                        aria-pressed={selected}
                        aria-label={`Zoom at ${formatTimecode(from)}, ${Math.round(zoomFx.scale * 100)}%`}
                        title={`Zoom ${Math.round(zoomFx.scale * 100)}%${zoomFx.spotlight ? ' with spotlight' : ''}`}
                        className={cn(
                          'absolute bottom-1 z-[1] h-2.5 touch-none rounded-sm bg-violet-500/80 hover:bg-violet-600',
                          canEdit && 'cursor-grab',
                          selected && 'ring-2 ring-violet-800',
                        )}
                        style={{ left: pct(from, total), width: pct(to - from, total) }}
                      />
                      {canEdit && selected && (
                        <EdgeHandle label="Length of zoom" side="end" leftPct={pct(to, total)} valueMs={zoomFx.durationMs} handlers={drag.handlers({ kind: 'zoom-end', zoomId: zoomFx.id })} />
                      )}
                    </div>
                  );
                }),
              )}
              {playhead}
            </div>

            {shown.tracks.map((track) =>
              track.kind === 'audio' ? <AudioRow key={track.id} track={track} ctx={ctx} /> : <OverlayRow key={track.id} track={track} ctx={ctx} />,
            )}
          </div>
        </div>
      </div>
      {canEdit && (
        <p className="mt-3 text-xs text-slate-500">
          Drag clip edges to trim and clips to move them (they snap to the playhead and cuts; hold Alt to move freely).
          {timeline.scenes.length > 1 && ' Drag a scene onto another to reorder.'}
        </p>
      )}
    </div>
  );
}

function ZoomButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick(): void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-6 w-6 rounded border border-slate-300 text-sm leading-none hover:bg-slate-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
