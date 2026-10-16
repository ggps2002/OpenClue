import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { formatDuration, formatTimecode } from '../../lib/format';
import { clipLength, type Timeline } from './Timeline';
import type { TimelineSource } from './timeline.api';

export type Selection = { kind: 'scene'; id: string } | { kind: 'clip'; trackId: string; clipId: string } | null;

interface TimelineStripProps {
  timeline: Timeline;
  sources: TimelineSource[];
  timeMs: number;
  selection: Selection;
  canEdit: boolean;
  onSelect(selection: Selection): void;
  onSeek(timeMs: number): void;
  onMoveScene(sceneId: string, toIndex: number): void;
}

const pct = (ms: number, total: number) => `${total === 0 ? 0 : (ms / total) * 100}%`;

/** Picks a ruler step that gives roughly 5–10 ticks. */
function tickStep(totalMs: number): number {
  const steps = [1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
  return steps.find((s) => totalMs / s <= 10) ?? 1_200_000;
}

/** The track view: a ruler, the scene row and one row per audio track, all sharing one time scale. */
export function TimelineStrip(props: TimelineStripProps) {
  const { timeline, sources, timeMs, selection, canEdit, onSelect, onSeek, onMoveScene } = props;
  const [dragging, setDragging] = useState<string | null>(null);
  const total = Math.max(timeline.durationMs, 1000);
  const names = new Map(sources.map((s) => [s.id, s.name]));
  const step = tickStep(total);
  const ticks = Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step);

  /** Seeks to where the lane was clicked. */
  const seekFromLane = (e: MouseEvent<HTMLElement>) => {
    const lane = e.currentTarget.closest<HTMLElement>('[data-lane]') ?? e.currentTarget;
    const rect = lane.getBoundingClientRect();
    if (rect.width > 0) onSeek(((e.clientX - rect.left) / rect.width) * total);
  };

  const drop = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    if (dragging) onMoveScene(dragging, index);
    setDragging(null);
  };

  const playhead = (
    <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: pct(timeMs, total) }} />
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Timeline">
      <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2">
        <div />
        <div data-lane className="relative h-5 cursor-pointer text-[10px] text-slate-500" onClick={seekFromLane}>
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 -translate-x-1/2 first:translate-x-0" style={{ left: pct(t, total) }}>
              {formatDuration(t)}
            </span>
          ))}
          {playhead}
        </div>

        <div className="self-center text-xs font-semibold text-slate-700">Scenes</div>
        <div data-lane className="relative h-14 rounded-lg bg-slate-100" onClick={seekFromLane}>
          {timeline.placements().map(({ scene, index, startMs }) => {
            const selected = selection?.kind === 'scene' && selection.id === scene.id;
            const missing = !names.has(scene.mediaId);
            return (
              <button
                key={scene.id}
                type="button"
                draggable={canEdit}
                onDragStart={() => setDragging(scene.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={drop(index)}
                onClick={(e) => {
                  e.stopPropagation();
                  seekFromLane(e);
                  onSelect({ kind: 'scene', id: scene.id });
                }}
                aria-pressed={selected}
                aria-label={`${scene.name || `Scene ${index + 1}`}, ${formatTimecode(clipLength(scene))}`}
                className={cn(
                  'absolute inset-y-1 overflow-hidden rounded-md border px-2 text-left text-xs',
                  missing ? 'border-red-300 bg-red-100 text-red-800' : 'border-indigo-300 bg-indigo-100 text-indigo-900',
                  selected && 'ring-2 ring-indigo-600',
                  dragging === scene.id && 'opacity-50',
                )}
                style={{ left: pct(startMs, total), width: pct(clipLength(scene), total) }}
              >
                <span className="block truncate font-medium">{scene.name || `Scene ${index + 1}`}</span>
                <span className="block truncate text-[10px] opacity-75">
                  {missing ? 'Source missing' : names.get(scene.mediaId)}
                </span>
              </button>
            );
          })}
          {playhead}
        </div>

        {timeline.tracks.map((track) => (
          <TrackRow key={track.id} {...{ track, total, selection, onSelect, seekFromLane, playhead }} />
        ))}
      </div>
      {canEdit && timeline.scenes.length > 1 && (
        <p className="mt-3 text-xs text-slate-500">Drag a scene onto another to reorder.</p>
      )}
    </div>
  );
}

interface TrackRowProps {
  track: Timeline['tracks'][number];
  total: number;
  selection: Selection;
  onSelect(selection: Selection): void;
  seekFromLane(e: MouseEvent<HTMLElement>): void;
  playhead: ReactNode;
}

function TrackRow({ track, total, selection, onSelect, seekFromLane, playhead }: TrackRowProps) {
  return (
    <>
      <div className="self-center truncate text-xs font-semibold text-slate-700">
        {track.name}
        {track.muted && <span className="ml-1 font-normal text-slate-400">(muted)</span>}
      </div>
      <div data-lane className="relative h-9 rounded-lg bg-slate-100" onClick={seekFromLane}>
        {track.clips.map((clip) => {
          const selected = selection?.kind === 'clip' && selection.clipId === clip.id;
          return (
            <button
              key={clip.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                seekFromLane(e);
                onSelect({ kind: 'clip', trackId: track.id, clipId: clip.id });
              }}
              aria-pressed={selected}
              aria-label={`${track.name} clip at ${formatTimecode(clip.startMs)}`}
              className={cn(
                'absolute inset-y-1 overflow-hidden rounded-md border border-emerald-300 bg-emerald-100 px-2 text-left text-[10px] text-emerald-900',
                track.muted && 'opacity-50',
                selected && 'ring-2 ring-emerald-600',
              )}
              style={{ left: pct(clip.startMs, total), width: pct(clipLength(clip), total) }}
            >
              <span className="block truncate">{clip.source.type === 'voiceover' ? 'Voiceover' : 'Audio'}</span>
            </button>
          );
        })}
        {playhead}
      </div>
    </>
  );
}
