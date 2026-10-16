import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { formatTimecode } from '../../lib/format';
import { NameField, SecondsField } from './fields';
import { OverlayInspector } from './OverlayInspector';
import { createOverlay, type OverlayKind } from './overlays';
import { clipLength, type Timeline } from './Timeline';
import type { TimelineSource } from './timeline.api';
import type { Selection } from './TimelineStrip';
import { TransitionFields } from './TransitionFields';

interface InspectorProps {
  timeline: Timeline;
  sources: TimelineSource[];
  selection: Selection;
  timeMs: number;
  canEdit: boolean;
  apply(edit: (timeline: Timeline) => Timeline): void;
  onSelect(selection: Selection): void;
  onSeek(timeMs: number): void;
}

/** Side panel for the selected scene, audio clip or overlay; offers "add scene/overlay" when nothing is selected. */
export function Inspector(props: InspectorProps) {
  const { timeline, selection } = props;
  const scene = selection?.kind === 'scene' ? timeline.placement(selection.id) : undefined;
  const track = selection?.kind === 'clip' ? timeline.audioTracks.find((t) => t.id === selection.trackId) : undefined;
  const clip = selection?.kind === 'clip' ? track?.clips.find((c) => c.id === selection.clipId) : undefined;
  const overlay = selection?.kind === 'overlay' ? timeline.overlay(selection.clipId) : undefined;

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="Inspector">
      {scene ? (
        <SceneInspector {...props} placed={scene} />
      ) : track && clip ? (
        <ClipInspector {...props} track={track} clip={clip} />
      ) : overlay ? (
        <OverlayInspector {...props} {...overlay} onRemoved={() => props.onSelect(null)} />
      ) : (
        <Overview {...props} />
      )}
    </aside>
  );
}

function SceneInspector({ timeline, sources, timeMs, canEdit, apply, onSelect, onSeek, placed }: InspectorProps & { placed: NonNullable<ReturnType<Timeline['placement']>> }) {
  const { scene, index, startMs, endMs } = placed;
  const source = sources.find((s) => s.id === scene.mediaId);
  const maxOut = source?.durationMs ?? Infinity;
  const underPlayhead = timeMs >= startMs && timeMs < endMs;
  const sourceAtPlayhead = scene.inMs + (timeMs - startMs);
  const last = timeline.scenes.length - 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Scene {index + 1}</h2>
        <p className={source ? 'text-xs text-slate-500' : 'text-xs text-red-600'}>
          {source ? `From ${source.name}` : 'Its video was removed from the project. Delete this scene to save.'}
        </p>
      </div>
      <NameField label="Name" value={scene.name} disabled={!canEdit} onCommit={(name) => apply((t) => t.renameScene(scene.id, name))} />
      <div className="grid grid-cols-2 gap-3">
        <SecondsField label="Starts at (s)" ms={scene.inMs} disabled={!canEdit} onCommit={(inMs) => apply((t) => t.trimScene(scene.id, { inMs }, maxOut))} />
        <SecondsField label="Ends at (s)" ms={scene.outMs} disabled={!canEdit} onCommit={(outMs) => apply((t) => t.trimScene(scene.id, { outMs }, maxOut))} />
      </div>
      <p className="text-xs text-slate-500">
        Plays {formatTimecode(clipLength(scene))} of the source, at {formatTimecode(startMs)}–{formatTimecode(endMs)} in the video.
      </p>
      {canEdit && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!underPlayhead} onClick={() => apply((t) => t.trimScene(scene.id, { inMs: sourceAtPlayhead }, maxOut))}>
              Trim start to playhead
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!underPlayhead} onClick={() => apply((t) => t.trimScene(scene.id, { outMs: sourceAtPlayhead }, maxOut))}>
              Trim end to playhead
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={scene.muted} onChange={(e) => apply((t) => t.setSceneMuted(scene.id, e.target.checked))} />
            Mute the video's own sound
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={index === 0} onClick={() => apply((t) => t.moveScene(scene.id, index - 1))}>
              Move earlier
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={index === last} onClick={() => apply((t) => t.moveScene(scene.id, index + 1))}>
              Move later
            </Button>
            <Button
              variant="ghost"
              className="px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
              onClick={() => {
                apply((t) => t.removeScene(scene.id));
                onSelect(null);
              }}
            >
              Delete scene
            </Button>
          </div>
        </>
      )}
      {index > 0 && <TransitionFields timeline={timeline} sceneIndex={index} canEdit={canEdit} apply={apply} onSeek={onSeek} />}
    </div>
  );
}

type Track = Timeline['audioTracks'][number];

function ClipInspector({ canEdit, apply, onSelect, track, clip }: InspectorProps & { track: Track; clip: Track['clips'][number] }) {
  const trackId = track.id;
  const clipId = clip.id;
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{track.name}</h2>
        <p className="text-xs text-slate-500">
          {clip.source.type === 'voiceover' ? 'The generated voiceover' : 'An audio clip'}, {formatTimecode(clipLength(clip))} long.
        </p>
      </div>
      <SecondsField label="Starts at (s)" ms={clip.startMs} disabled={!canEdit} onCommit={(startMs) => apply((t) => t.moveClip(trackId, clipId, startMs))} />
      {canEdit && (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={track.muted} onChange={(e) => apply((t) => t.setTrackMuted(trackId, e.target.checked))} />
            Mute this track
          </label>
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
            onClick={() => {
              apply((t) => t.removeClip(trackId, clipId));
              onSelect(null);
            }}
          >
            Remove clip
          </Button>
        </>
      )}
    </div>
  );
}

function Overview({ timeline, sources, timeMs, canEdit, apply, onSelect }: InspectorProps) {
  const videos = sources.filter((s) => s.kind === 'video' && s.durationMs);
  const images = sources.filter((s) => s.kind === 'image');
  const [mediaId, setMediaId] = useState(videos[0]?.id ?? '');
  const [imageId, setImageId] = useState(images[0]?.id ?? '');
  const chosen = videos.find((v) => v.id === mediaId);
  const addOverlay = (kind: OverlayKind) => {
    const clip = createOverlay(crypto.randomUUID(), kind, timeMs, imageId);
    apply((t) => t.addOverlay(clip));
    onSelect({ kind: 'overlay', clipId: clip.id });
  };
  return (
    <div className="space-y-4 text-sm text-slate-600">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Your edit</h2>
        <p className="mt-1">
          {timeline.scenes.length} scene{timeline.scenes.length === 1 ? '' : 's'}, {formatTimecode(timeline.durationMs)} in total. Select a scene,
          clip or overlay to change it.
        </p>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-xs">
        <li>Space plays or pauses, S splits the scene under the playhead.</li>
        <li>Ctrl+Z undoes, Ctrl+Shift+Z redoes.</li>
      </ul>
      {canEdit && videos.length > 0 && (
        <div className="space-y-2 border-t border-slate-200 pt-4">
          <label htmlFor="add-scene-source" className="text-xs font-medium text-slate-600">
            Add a video as a new scene
          </label>
          <select id="add-scene-source" className="block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
            {videos.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!chosen} onClick={() => chosen?.durationMs && apply((t) => t.addScene(chosen.id, chosen.durationMs ?? 0))}>
            Add scene
          </Button>
        </div>
      )}
      {canEdit && (
        <div className="space-y-2 border-t border-slate-200 pt-4">
          <p className="text-xs font-medium text-slate-600">Add an overlay at the playhead</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => addOverlay('text')}>
              Add text
            </Button>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => addOverlay('shape')}>
              Add shape
            </Button>
          </div>
          {images.length > 0 ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label htmlFor="add-overlay-image" className="text-xs font-medium text-slate-600">
                  Image
                </label>
                <select id="add-overlay-image" className="block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" value={imageId} onChange={(e) => setImageId(e.target.value)}>
                  {images.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!images.some((i) => i.id === imageId)} onClick={() => addOverlay('image')}>
                Add image
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Upload an image to this project to use it as an overlay.</p>
          )}
        </div>
      )}
    </div>
  );
}
