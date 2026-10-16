import { useEffect, useMemo, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Inspector } from './Inspector';
import { OverlayLayer } from './OverlayLayer';
import { setValuesAt } from './overlays';
import { PreviewPlayer } from './PreviewPlayer';
import { Timeline } from './Timeline';
import { timelineApi, type TimelineData } from './timeline.api';
import { TimelineStrip, type Selection } from './TimelineStrip';
import { useTimelineHistory } from './useTimelineHistory';
import { useTimelinePlayer } from './useTimelinePlayer';
import { ZoomFraming } from './ZoomFraming';

interface EditorWorkspaceProps {
  data: TimelineData & { timeline: NonNullable<TimelineData['timeline']> };
  onSaved(data: TimelineData): void;
  onStartOver(): void;
}

/** The editor once a timeline exists: preview, inspector, timeline strip, undo/redo and save. */
export function EditorWorkspace({ data, onSaved, onStartOver }: EditorWorkspaceProps) {
  const canEdit = data.role !== 'viewer';
  const [saved, setSaved] = useState(data.timeline);
  const { timeline, apply, undo, redo, canUndo, canRedo } = useTimelineHistory(new Timeline(data.timeline));
  const player = useTimelinePlayer(timeline, data);
  const [selection, setSelection] = useState<Selection>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = timeline.doc !== saved;
  const { timeMs } = player.state;
  const framingZoomId = selection?.kind === 'zoom' ? selection.zoomId : null;
  // The selected zoom is shown unzoomed with its framing outlined, so it can be repositioned.
  const zooms = useMemo(() => {
    const { incoming, outgoing } = timeline.zoomsAt(timeMs);
    return { incoming: incoming?.zoomId === framingZoomId ? null : incoming, outgoing };
  }, [timeline, timeMs, framingZoomId]);
  const imageUrls = useMemo(() => new Map(data.sources.filter((s) => s.kind === 'image').map((s) => [s.id, s.url])), [data.sources]);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const result = await timelineApi.save(data.projectId, timeline.toJSON());
      setSaved(timeline.doc);
      onSaved(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the edit');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === ' ' && !target?.closest('button')) {
        e.preventDefault();
        player.toggle();
      } else if (canEdit && mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (canEdit && !mod && e.key.toLowerCase() === 's') {
        apply((t) => t.splitAt(timeMs));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, canEdit, player, redo, timeMs, undo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={undo} disabled={!canUndo}>
            Undo
          </Button>
          <Button variant="secondary" onClick={redo} disabled={!canRedo}>
            Redo
          </Button>
          <Button variant="secondary" onClick={() => apply((t) => t.splitAt(timeMs))} disabled={!timeline.canSplitAt(timeMs)}>
            Split at playhead
          </Button>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-500" aria-live="polite">
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm('Start over from the original video? Your current edit will be replaced.')) onStartOver();
              }}
            >
              Start over
            </Button>
            <Button onClick={() => void save()} disabled={!dirty || saving}>
              Save edit
            </Button>
          </div>
        </div>
      )}
      {!canEdit && <p className="text-sm text-slate-500">You can watch this edit; only editors can change it.</p>}
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <PreviewPlayer
          videoRefs={player.videoRefs}
          state={player.state}
          durationMs={timeline.durationMs}
          onToggle={player.toggle}
          onSeek={player.seek}
          zooms={zooms}
          aspects={player.aspects}
        >
          {framingZoomId && (
            <ZoomFraming
              timeline={timeline}
              timeMs={timeMs}
              zoomId={framingZoomId}
              aspect={player.aspects[player.state.slot]}
              canEdit={canEdit}
              onMove={(zoomId, focus) => apply((t) => t.updateZoom(zoomId, focus))}
            />
          )}
          <OverlayLayer
            timeline={timeline}
            timeMs={timeMs}
            imageUrls={imageUrls}
            selectedId={selection?.kind === 'overlay' ? selection.clipId : null}
            canEdit={canEdit}
            onSelect={(clipId) => setSelection({ kind: 'overlay', clipId })}
            onMove={(clipId, localMs, position) => apply((t) => t.updateOverlay(clipId, (c) => setValuesAt(c, localMs, position)))}
          />
        </PreviewPlayer>
        <Inspector
          timeline={timeline}
          sources={data.sources}
          selection={selection}
          timeMs={timeMs}
          canEdit={canEdit}
          apply={apply}
          onSelect={setSelection}
          onSeek={player.seek}
        />
      </div>
      <TimelineStrip
        timeline={timeline}
        sources={data.sources}
        timeMs={timeMs}
        selection={selection}
        canEdit={canEdit}
        onSelect={setSelection}
        onSeek={player.seek}
        onMoveScene={(id, index) => apply((t) => t.moveScene(id, index))}
      />
    </div>
  );
}
