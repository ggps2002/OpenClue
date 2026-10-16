import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { formatTimecode } from '../../lib/format';
import { SecondsField } from './fields';
import { clipLength, type Timeline } from './Timeline';
import {
  DEFAULT_TRANSITION_MS,
  maxTransitionMs,
  MIN_TRANSITION_MS,
  TRANSITION_LABELS,
  TRANSITION_TYPES,
  type TransitionType,
} from './transitions';

interface TransitionFieldsProps {
  timeline: Timeline;
  sceneIndex: number;
  canEdit: boolean;
  apply(edit: (timeline: Timeline) => Timeline): void;
  onSeek(timeMs: number): void;
}

/** Picks how a scene takes over from the one before it. */
export function TransitionFields({ timeline, sceneIndex, canEdit, apply, onSeek }: TransitionFieldsProps) {
  const selectId = useId();
  const scene = timeline.scenes[sceneIndex];
  const previous = timeline.scenes[sceneIndex - 1];
  const max = maxTransitionMs(clipLength(previous), clipLength(scene));
  const transition = scene.transition ?? null;
  const tooShort = max < MIN_TRANSITION_MS;

  const setType = (value: string) => {
    if (value === 'none') return apply((t) => t.setTransition(scene.id, null));
    const type = value as TransitionType;
    apply((t) => t.setTransition(scene.id, { type, durationMs: transition?.durationMs ?? DEFAULT_TRANSITION_MS }));
  };

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <div>
        <label htmlFor={selectId} className="text-xs font-medium text-slate-600">
          Transition from “{previous.name || `Scene ${sceneIndex}`}”
        </label>
        <select
          id={selectId}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm disabled:bg-slate-50"
          value={transition?.type ?? 'none'}
          disabled={!canEdit || (tooShort && !transition)}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="none">Cut (no transition)</option>
          {TRANSITION_TYPES.map((type) => (
            <option key={type} value={type}>
              {TRANSITION_LABELS[type]}
            </option>
          ))}
        </select>
        {tooShort && <p className="mt-1 text-xs text-slate-500">These scenes are too short for a transition.</p>}
      </div>
      {transition && (
        <>
          <SecondsField
            label={`Length (s, up to ${(max / 1000).toFixed(1)})`}
            ms={transition.durationMs}
            disabled={!canEdit}
            onCommit={(durationMs) => apply((t) => t.setTransition(scene.id, { ...transition, durationMs }))}
          />
          <p className="text-xs text-slate-500">The two scenes overlap for {formatTimecode(transition.durationMs)}, which shortens the video by as much.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                const placed = timeline.placement(scene.id);
                if (placed) onSeek(Math.max(0, placed.startMs - 1000));
              }}
            >
              Jump to just before
            </Button>
            {canEdit && timeline.scenes.length > 2 && (
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => apply((t) => t.setAllTransitions(transition))}
              >
                Use on every cut
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
