import { useId, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { formatDuration } from '../../lib/format';
import type { ScriptSegment } from './script.api';
import { msToSeconds, pace, secondsToMs } from './segments';

interface SegmentRowProps {
  segment: ScriptSegment;
  index: number;
  issue?: string;
  active: boolean;
  canEdit: boolean;
  canMerge: boolean;
  canInsertAfter: boolean;
  onChange(patch: Partial<Omit<ScriptSegment, 'id'>>): void;
  onPlay(): void;
  onSplit(): void;
  onMerge(): void;
  onRemove(): void;
  onInsertAfter(): void;
  /** Extra per-segment content, e.g. voiceover controls. */
  footer?: ReactNode;
}

const smallButton = 'px-2 py-1 text-xs';

export function SegmentRow(props: SegmentRowProps) {
  const { segment, index, issue, active, canEdit } = props;
  const id = useId();
  const { words, budget, tooLong } = pace(segment);
  const label = `Segment ${index + 1}`;

  return (
    <li
      aria-label={label}
      className={cn(
        'rounded-xl border bg-white p-4 transition-colors',
        active ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200',
        issue && 'border-red-300',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{index + 1}</span>
        {canEdit ? (
          <>
            <TimeInput id={`${id}-start`} label="Start" value={segment.startMs} onChange={(startMs) => props.onChange({ startMs })} />
            <TimeInput id={`${id}-end`} label="End" value={segment.endMs} onChange={(endMs) => props.onChange({ endMs })} />
          </>
        ) : (
          <span className="text-xs text-slate-600">
            {formatDuration(segment.startMs)} – {formatDuration(segment.endMs)}
          </span>
        )}
        <Button variant="ghost" className={smallButton} onClick={props.onPlay} aria-label={`Play ${label.toLowerCase()}`}>
          ▶ Play
        </Button>
        <span className={cn('ml-auto text-xs', tooLong ? 'font-medium text-amber-700' : 'text-slate-500')}>
          {words} / {budget} words{tooLong && ' · too long for its slot'}
        </span>
      </div>

      {canEdit ? (
        <>
          <label htmlFor={`${id}-text`} className="sr-only">
            {label} text
          </label>
          <textarea
            id={`${id}-text`}
            value={segment.text}
            rows={2}
            onChange={(e) => props.onChange({ text: e.target.value })}
            placeholder="Write what the voiceover says here"
            className="mt-3 block w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </>
      ) : (
        <p className="mt-3 text-sm text-slate-800">{segment.text || <em className="text-slate-400">No narration</em>}</p>
      )}

      {issue && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {issue}
        </p>
      )}

      {canEdit && (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant="ghost" className={smallButton} onClick={props.onSplit} aria-label={`Split ${label.toLowerCase()}`}>
            Split
          </Button>
          <Button
            variant="ghost"
            className={smallButton}
            onClick={props.onMerge}
            disabled={!props.canMerge}
            aria-label={`Merge ${label.toLowerCase()} with the next`}
          >
            Merge with next
          </Button>
          <Button
            variant="ghost"
            className={smallButton}
            onClick={props.onInsertAfter}
            disabled={!props.canInsertAfter}
            aria-label={`Add a segment after ${label.toLowerCase()}`}
          >
            Add after
          </Button>
          <Button variant="ghost" className={cn(smallButton, 'text-red-700')} onClick={props.onRemove} aria-label={`Delete ${label.toLowerCase()}`}>
            Delete
          </Button>
        </div>
      )}
      {props.footer}
    </li>
  );
}

function TimeInput({ id, label, value, onChange }: { id: string; label: string; value: number; onChange(ms: number): void }) {
  return (
    <span className="flex items-center gap-1">
      <label htmlFor={id} className="text-xs text-slate-600">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        step={0.1}
        // Uncontrolled while typing would lose partial input like "1."; the key resets it on outside changes.
        key={value}
        defaultValue={msToSeconds(value)}
        onBlur={(e) => {
          const ms = secondsToMs(e.target.value);
          if (ms !== value) onChange(ms);
        }}
        className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      <span className="text-xs text-slate-500">s</span>
    </span>
  );
}
