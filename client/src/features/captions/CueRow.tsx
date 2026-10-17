import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { formatDuration } from '../../lib/format';
import { TimeInput } from '../script/SegmentRow';
import type { CaptionCue } from './captions.api';

interface CueRowProps {
  cue: CaptionCue;
  index: number;
  issue?: string;
  active: boolean;
  canEdit: boolean;
  canMerge: boolean;
  onChange(patch: Partial<Omit<CaptionCue, 'id'>>): void;
  onPlay(): void;
  onSplit(): void;
  onMerge(): void;
  onRemove(): void;
}

const smallButton = 'px-2 py-1 text-xs';

export function CueRow(props: CueRowProps) {
  const { cue, index, issue, active, canEdit } = props;
  const id = useId();
  const label = `Caption ${index + 1}`;
  const lines = cue.text.split('\n');

  return (
    <li
      aria-label={label}
      className={cn(
        'rounded-xl border bg-white p-3 transition-colors',
        active ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200',
        issue && 'border-red-300',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{index + 1}</span>
        {canEdit ? (
          <>
            <TimeInput id={`${id}-start`} label="Start" value={cue.startMs} onChange={(startMs) => props.onChange({ startMs })} />
            <TimeInput id={`${id}-end`} label="End" value={cue.endMs} onChange={(endMs) => props.onChange({ endMs })} />
          </>
        ) : (
          <span className="text-xs text-slate-600">
            {formatDuration(cue.startMs)} – {formatDuration(cue.endMs)}
          </span>
        )}
        <Button variant="ghost" className={smallButton} onClick={props.onPlay} aria-label={`Play ${label.toLowerCase()}`}>
          ▶ Play
        </Button>
        <span className="ml-auto text-xs text-slate-500">
          {lines.length > 1 ? `${lines.length} lines · longest ${Math.max(...lines.map((l) => l.length))}` : `${cue.text.length}`} chars
        </span>
      </div>
      {canEdit ? (
        <>
          <label htmlFor={`${id}-text`} className="sr-only">
            {label} text
          </label>
          <textarea
            id={`${id}-text`}
            value={cue.text}
            rows={Math.min(3, Math.max(1, lines.length))}
            onChange={(e) => props.onChange({ text: e.target.value })}
            placeholder="Caption text (Enter for a second line)"
            className="mt-2 block w-full resize-y rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </>
      ) : (
        <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{cue.text}</p>
      )}
      {issue && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {issue}
        </p>
      )}
      {canEdit && (
        <div className="mt-1 flex flex-wrap gap-1">
          <Button variant="ghost" className={smallButton} onClick={props.onSplit} aria-label={`Split ${label.toLowerCase()}`}>
            Split
          </Button>
          <Button variant="ghost" className={smallButton} onClick={props.onMerge} disabled={!props.canMerge} aria-label={`Merge ${label.toLowerCase()} with the next`}>
            Merge with next
          </Button>
          <Button variant="ghost" className={cn(smallButton, 'text-red-700')} onClick={props.onRemove} aria-label={`Delete ${label.toLowerCase()}`}>
            Delete
          </Button>
        </div>
      )}
    </li>
  );
}
