import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { formatTimecode } from '../../lib/format';
import { NumberField, SecondsField } from './fields';
import type { PlacedScene, Timeline } from './Timeline';
import { timelineApi, type TimelineSource } from './timeline.api';
import type { Selection } from './TimelineStrip';
import { DEFAULT_ZOOM_SCALE, MAX_ZOOM_SCALE, zoomEnd, zoomsFromClicks, zoomSlotAt, type Zoom } from './zooms';

const smallButton = 'px-3 py-1.5 text-xs';

interface ZoomSectionProps {
  timeline: Timeline;
  placed: PlacedScene;
  source: TimelineSource | undefined;
  timeMs: number;
  canEdit: boolean;
  apply(edit: (timeline: Timeline) => Timeline): void;
  onSelect(selection: Selection): void;
  onSeek(timeMs: number): void;
}

/** Timeline time of a moment of the scene's source video. */
const toTimeline = (placed: PlacedScene, sourceMs: number) => placed.startMs + (sourceMs - placed.scene.inMs);

/** The scene inspector's list of zooms, with add, auto-zoom from recorded clicks, and remove all. */
export function ZoomSection({ timeline, placed, source, timeMs, canEdit, apply, onSelect, onSeek }: ZoomSectionProps) {
  const { scene } = placed;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  const zooms = timeline.visibleZooms(scene);
  const underPlayhead = timeMs >= placed.startMs && timeMs < placed.endMs;
  const sourceAtPlayhead = scene.inMs + (timeMs - placed.startMs);
  const slot = underPlayhead ? zoomSlotAt(scene.zooms ?? [], sourceAtPlayhead, scene) : null;
  const clickCount = source?.clickCount ?? 0;

  const select = (zoom: Zoom) => {
    onSelect({ kind: 'zoom', zoomId: zoom.id });
    onSeek(Math.max(placed.startMs, toTimeline(placed, zoom.startMs)));
  };

  const add = () => {
    if (!slot) return;
    const zoom: Zoom = { id: crypto.randomUUID(), ...slot, x: 0.5, y: 0.5, scale: DEFAULT_ZOOM_SCALE, spotlight: false };
    apply((t) => t.addZoom(scene.id, zoom));
    onSelect({ kind: 'zoom', zoomId: zoom.id });
  };

  /** Replaces the zooms shown in this scene with ones made from the clicks recorded in it. */
  const autoZoom = async () => {
    if (zooms.length > 0 && !window.confirm('Replace the zooms in this scene with ones made from your clicks?')) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const clicks = await timelineApi.clicks(scene.mediaId);
      const made = zoomsFromClicks(clicks, scene, () => crypto.randomUUID());
      const hidden = (scene.zooms ?? []).filter((z) => !zooms.includes(z));
      // Hidden zooms that would overlap the new ones are dropped too.
      const kept = hidden.filter((h) => made.every((m) => zoomEnd(h) <= m.startMs || h.startMs >= zoomEnd(m)));
      apply((t) => t.setZooms(scene.id, [...kept, ...made]));
      setMessage({ tone: 'info', text: made.length ? `Added ${made.length} zoom${made.length === 1 ? '' : 's'} from your clicks.` : 'No clicks were recorded in this part of the video.' });
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not load the recorded clicks' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <div>
        <h3 className="text-xs font-medium text-slate-600">Zoom and spotlight</h3>
        <p className="text-xs text-slate-500">
          {zooms.length === 0 ? 'No zooms in this scene.' : `${zooms.length} zoom${zooms.length === 1 ? '' : 's'}. Select one to frame it.`}
        </p>
      </div>
      {zooms.length > 0 && (
        <ul className="space-y-1">
          {zooms.map((zoom) => (
            <li key={zoom.id}>
              <button
                type="button"
                className="w-full rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-left text-xs text-violet-900 hover:bg-violet-100"
                onClick={() => select(zoom)}
              >
                Zoom at {formatTimecode(Math.max(placed.startMs, toTimeline(placed, zoom.startMs)))}, {Math.round(zoom.scale * 100)}%
                {zoom.spotlight && ' with spotlight'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className={smallButton} disabled={!slot} onClick={add}>
            Add zoom at playhead
          </Button>
          {clickCount > 0 && (
            <Button variant="secondary" className={smallButton} disabled={busy} onClick={() => void autoZoom()}>
              {busy ? 'Reading clicks…' : `Auto-zoom from ${clickCount} click${clickCount === 1 ? '' : 's'}`}
            </Button>
          )}
          {zooms.length > 0 && (
            <Button
              variant="ghost"
              className={`${smallButton} text-red-700 hover:bg-red-50`}
              onClick={() => apply((t) => t.setZooms(scene.id, (scene.zooms ?? []).filter((z) => !zooms.includes(z))))}
            >
              Remove zooms
            </Button>
          )}
        </div>
      )}
      {canEdit && clickCount === 0 && <p className="text-xs text-slate-500">Videos recorded in OpenClue can be zoomed automatically where you clicked.</p>}
      {message && (message.tone === 'error' ? <Alert>{message.text}</Alert> : <p className="text-xs text-slate-600" role="status">{message.text}</p>)}
    </div>
  );
}

interface ZoomInspectorProps {
  timeline: Timeline;
  sources: TimelineSource[];
  zoomId: string;
  canEdit: boolean;
  apply(edit: (timeline: Timeline) => Timeline): void;
  onSelect(selection: Selection): void;
  onSeek(timeMs: number): void;
}

/** Edits one zoom: timing (in timeline time), strength, focus point and spotlight. */
export function ZoomInspector({ timeline, sources, zoomId, canEdit, apply, onSelect, onSeek }: ZoomInspectorProps) {
  const found = timeline.zoom(zoomId);
  const placed = found && timeline.placement(found.scene.id);
  if (!found || !placed) return null;
  const { scene, zoom } = found;
  const sourceDuration = sources.find((s) => s.id === scene.mediaId)?.durationMs ?? undefined;
  const update = (changes: Partial<Omit<Zoom, 'id'>>) => apply((t) => t.updateZoom(zoom.id, changes, sourceDuration));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Zoom</h2>
        <p className="text-xs text-slate-500">
          In {scene.name || `Scene ${placed.index + 1}`}. Drag the outlined area on the preview to choose what to zoom in on.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SecondsField
          label="Starts at (s)"
          ms={toTimeline(placed, zoom.startMs)}
          disabled={!canEdit}
          onCommit={(ms) => update({ startMs: scene.inMs + (ms - placed.startMs) })}
        />
        <SecondsField label="Length (s)" ms={zoom.durationMs} disabled={!canEdit} onCommit={(durationMs) => update({ durationMs })} />
      </div>
      <NumberField
        label={`Zoom (%, up to ${MAX_ZOOM_SCALE * 100})`}
        value={zoom.scale}
        scale={100}
        step={10}
        disabled={!canEdit}
        onCommit={(scale) => update({ scale })}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Focus across (%)" value={zoom.x} scale={100} disabled={!canEdit} onCommit={(x) => update({ x })} />
        <NumberField label="Focus down (%)" value={zoom.y} scale={100} disabled={!canEdit} onCommit={(y) => update({ y })} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={zoom.spotlight} disabled={!canEdit} onChange={(e) => update({ spotlight: e.target.checked })} />
        Spotlight the focus point
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className={smallButton} onClick={() => onSeek(Math.max(0, toTimeline(placed, zoom.startMs) - 500))}>
          Jump to just before
        </Button>
        <Button variant="secondary" className={smallButton} onClick={() => onSelect({ kind: 'scene', id: scene.id })}>
          Back to scene
        </Button>
        {canEdit && (
          <Button
            variant="ghost"
            className={`${smallButton} text-red-700 hover:bg-red-50`}
            onClick={() => {
              apply((t) => t.removeZoom(zoom.id));
              onSelect({ kind: 'scene', id: scene.id });
            }}
          >
            Delete zoom
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">The zoom shows in the preview once you select something else.</p>
    </div>
  );
}
