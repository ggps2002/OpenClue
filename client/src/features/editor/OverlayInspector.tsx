import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { formatTimecode } from '../../lib/format';
import { ColorField, NumberField, SecondsField } from './fields';
import {
  addKeyframe,
  fadeInOut,
  keyframeNear,
  removeKeyframe,
  setDuration,
  setValuesAt,
  updateKeyframe,
  valuesAt,
  type Easing,
  type OverlayClip,
  type OverlayContent,
  type OverlayTrack,
} from './overlays';
import type { Timeline } from './Timeline';
import type { TimelineSource } from './timeline.api';

interface OverlayInspectorProps {
  track: OverlayTrack;
  clip: OverlayClip;
  sources: TimelineSource[];
  timeMs: number;
  canEdit: boolean;
  apply(edit: (timeline: Timeline) => Timeline): void;
  onSeek(timeMs: number): void;
  onRemoved(): void;
}

const selectClasses = 'mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50';
const smallButton = 'px-3 py-1.5 text-xs';

/** Edits one overlay: its content, box, timing and keyframed position/scale/opacity. */
export function OverlayInspector({ track, clip, sources, timeMs, canEdit, apply, onSeek, onRemoved }: OverlayInspectorProps) {
  const id = clip.id;
  const edit = (update: (clip: OverlayClip) => OverlayClip) => apply((t) => t.updateOverlay(id, update));
  const localMs = timeMs - clip.startMs;
  const inside = localMs >= 0 && localMs <= clip.durationMs;
  const values = valuesAt(clip, Math.max(0, Math.min(clip.durationMs, localMs)));
  const animated = clip.keyframes.length > 1;
  const editing = !animated ? null : keyframeNear(clip, localMs);
  const setValue = (key: keyof typeof values) => (value: number) => edit((c) => setValuesAt(c, localMs, { [key]: value }));
  const valuesDisabled = !canEdit || (animated && !inside);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{track.name}</h2>
        <p className="text-xs text-slate-500">
          A {clip.content.type} overlay from {formatTimecode(clip.startMs)} to {formatTimecode(clip.startMs + clip.durationMs)}.
        </p>
      </div>

      <ContentFields content={clip.content} sources={sources} disabled={!canEdit} onChange={(content) => edit((c) => ({ ...c, content }))} />

      <div className="grid grid-cols-2 gap-3">
        <SecondsField label="Starts at (s)" ms={clip.startMs} disabled={!canEdit} onCommit={(startMs) => apply((t) => t.moveClip(track.id, id, startMs))} />
        <SecondsField label="Lasts (s)" ms={clip.durationMs} disabled={!canEdit} onCommit={(ms) => edit((c) => setDuration(c, ms))} />
        <NumberField label="Width (%)" value={clip.width} scale={100} disabled={!canEdit} onCommit={(w) => edit((c) => ({ ...c, width: clampSize(w) }))} />
        <NumberField label="Height (%)" value={clip.height} scale={100} disabled={!canEdit} onCommit={(h) => edit((c) => ({ ...c, height: clampSize(h) }))} />
      </div>

      <fieldset className="space-y-2 border-t border-slate-200 pt-4">
        <legend className="text-xs font-semibold text-slate-900">{animated ? 'At the playhead' : 'Position and look'}</legend>
        <p className="text-xs text-slate-500">
          {!animated
            ? 'Drag the overlay in the preview to move it. Add keyframes to animate it.'
            : !inside
              ? 'Move the playhead over this overlay to change its animation.'
              : editing
                ? `Editing the keyframe at ${formatTimecode(editing.t)}.`
                : 'Changing a value adds a keyframe here.'}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Across (%)" value={values.x} scale={100} disabled={valuesDisabled} onCommit={setValue('x')} />
          <NumberField label="Down (%)" value={values.y} scale={100} disabled={valuesDisabled} onCommit={setValue('y')} />
          <NumberField label="Scale (%)" value={values.scale} scale={100} step={5} disabled={valuesDisabled} onCommit={setValue('scale')} />
          <NumberField label="Opacity (%)" value={values.opacity} scale={100} step={5} disabled={valuesDisabled} onCommit={setValue('opacity')} />
        </div>
      </fieldset>

      <Keyframes clip={clip} canEdit={canEdit} onSeek={(t) => onSeek(clip.startMs + t)} edit={edit} />
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className={smallButton} disabled={!inside || clip.keyframes.some((k) => k.t === Math.round(localMs))} onClick={() => edit((c) => addKeyframe(c, localMs))}>
            Add keyframe at playhead
          </Button>
          <Button variant="secondary" className={smallButton} onClick={() => edit(fadeInOut)}>
            Fade in and out
          </Button>
        </div>
      )}

      {canEdit && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={track.hidden} onChange={(e) => apply((t) => t.setTrackHidden(track.id, e.target.checked))} />
            Hide this track
          </label>
          <Button
            variant="ghost"
            className={`${smallButton} text-red-700 hover:bg-red-50`}
            onClick={() => {
              apply((t) => t.removeClip(track.id, id));
              onRemoved();
            }}
          >
            Remove overlay
          </Button>
        </div>
      )}
    </div>
  );
}

const clampSize = (value: number) => Math.max(0.01, Math.min(2, Math.round(value * 1000) / 1000));

function Keyframes({ clip, canEdit, onSeek, edit }: { clip: OverlayClip; canEdit: boolean; onSeek(t: number): void; edit(update: (clip: OverlayClip) => OverlayClip): void }) {
  if (clip.keyframes.length < 2) return null;
  return (
    <ul className="space-y-1.5" aria-label="Keyframes">
      {clip.keyframes.map((k, i) => (
        <li key={k.t} className="flex items-center gap-2 text-xs text-slate-600">
          <button type="button" className="font-mono text-indigo-700 hover:underline" onClick={() => onSeek(k.t)} aria-label={`Go to keyframe at ${formatTimecode(k.t)}`}>
            {formatTimecode(k.t)}
          </button>
          <span className="flex-1 truncate">
            {Math.round(k.x * 100)}%, {Math.round(k.y * 100)}% · {Math.round(k.scale * 100)}% · {Math.round(k.opacity * 100)}% opaque
          </span>
          {i < clip.keyframes.length - 1 && (
            <select
              aria-label={`Motion after ${formatTimecode(k.t)}`}
              className="rounded border border-slate-300 px-1 py-0.5"
              value={k.easing}
              disabled={!canEdit}
              onChange={(e) => edit((c) => updateKeyframe(c, k.t, { easing: e.target.value as Easing }))}
            >
              <option value="easeInOut">Smooth</option>
              <option value="linear">Linear</option>
            </select>
          )}
          {canEdit && (
            <button type="button" className="text-red-700 hover:underline" aria-label={`Delete keyframe at ${formatTimecode(k.t)}`} onClick={() => edit((c) => removeKeyframe(c, k.t))}>
              Delete
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ContentFields({ content, sources, disabled, onChange }: { content: OverlayContent; sources: TimelineSource[]; disabled: boolean; onChange(content: OverlayContent): void }) {
  const id = useId();
  if (content.type === 'text') {
    return (
      <div className="space-y-3">
        <div>
          <label htmlFor={id} className="text-xs font-medium text-slate-600">
            Text
          </label>
          <TextArea id={id} value={content.text} disabled={disabled} onCommit={(text) => onChange({ ...content, text })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Text size (%)" value={content.fontSize} scale={100} step={0.5} disabled={disabled} onCommit={(f) => onChange({ ...content, fontSize: Math.max(0.01, Math.min(0.5, f)) })} />
          <div>
            <label htmlFor={`${id}-align`} className="text-xs font-medium text-slate-600">
              Align
            </label>
            <select id={`${id}-align`} className={selectClasses} value={content.align} disabled={disabled} onChange={(e) => onChange({ ...content, align: e.target.value as typeof content.align })}>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={content.bold} disabled={disabled} onChange={(e) => onChange({ ...content, bold: e.target.checked })} />
          Bold
        </label>
        <ColorField label="Text color" value={content.color} disabled={disabled} onChange={(color) => color && onChange({ ...content, color })} />
        <ColorField label="Background" value={content.background} nullable disabled={disabled} onChange={(background) => onChange({ ...content, background })} />
      </div>
    );
  }
  if (content.type === 'shape') {
    return (
      <div className="space-y-3">
        <div>
          <label htmlFor={id} className="text-xs font-medium text-slate-600">
            Shape
          </label>
          <select id={id} className={selectClasses} value={content.shape} disabled={disabled} onChange={(e) => onChange({ ...content, shape: e.target.value as typeof content.shape })}>
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
          </select>
        </div>
        <ColorField label="Fill" value={content.fill} nullable disabled={disabled} onChange={(fill) => onChange({ ...content, fill })} />
        <ColorField label="Outline" value={content.stroke} nullable disabled={disabled} onChange={(stroke) => onChange({ ...content, stroke })} />
      </div>
    );
  }
  const images = sources.filter((s) => s.kind === 'image');
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        Image
      </label>
      <select id={id} className={selectClasses} value={content.mediaId} disabled={disabled} onChange={(e) => onChange({ ...content, mediaId: e.target.value })}>
        {!images.some((i) => i.id === content.mediaId) && <option value={content.mediaId}>Missing image</option>}
        {images.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A textarea committed on blur, so typing is one undo step. */
function TextArea({ id, value, disabled, onCommit }: { id: string; value: string; disabled: boolean; onCommit(value: string): void }) {
  return (
    <textarea
      key={value}
      id={id}
      rows={2}
      maxLength={500}
      defaultValue={value}
      disabled={disabled}
      className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
    />
  );
}
