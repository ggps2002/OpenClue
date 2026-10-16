import { useEffect, useId, useState } from 'react';

const inputClasses =
  'mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-50';

/**
 * A text input that commits on blur or Enter, so typing doesn't create one undo step per keystroke.
 * Escape restores the current value.
 */
function useDraft(value: string, onCommit: (draft: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return {
    value: draft,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => draft !== value && onCommit(draft),
    onKeyDown: (e: { key: string; currentTarget: HTMLInputElement }) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') setDraft(value);
    },
  };
}

export function NameField({ label, value, disabled, onCommit }: { label: string; value: string; disabled?: boolean; onCommit(value: string): void }) {
  const id = useId();
  const draft = useDraft(value, (v) => onCommit(v.trim()));
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input id={id} className={inputClasses} maxLength={80} disabled={disabled} {...draft} />
    </div>
  );
}

/** Edits a millisecond value as seconds with one decimal. */
export function SecondsField({ label, ms, disabled, onCommit }: { label: string; ms: number; disabled?: boolean; onCommit(ms: number): void }) {
  const id = useId();
  const draft = useDraft((ms / 1000).toFixed(1), (v) => {
    const seconds = Number(v);
    if (v.trim() !== '' && Number.isFinite(seconds)) onCommit(Math.round(seconds * 1000));
  });
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input id={id} type="number" step={0.1} min={0} className={inputClasses} disabled={disabled} {...draft} />
    </div>
  );
}
