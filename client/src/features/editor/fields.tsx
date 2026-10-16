import { useEffect, useId, useRef, useState } from 'react';

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

/** A number input committed on blur/Enter; `scale` converts the stored value for display (e.g. 100 for percent). */
export function NumberField({
  label,
  value,
  scale = 1,
  step = 1,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  scale?: number;
  step?: number;
  disabled?: boolean;
  onCommit(value: number): void;
}) {
  const id = useId();
  const draft = useDraft(String(Math.round(value * scale * 10) / 10), (v) => {
    const n = Number(v);
    if (v.trim() !== '' && Number.isFinite(n)) onCommit(n / scale);
  });
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <input id={id} type="number" step={step} className={inputClasses} disabled={disabled} {...draft} />
    </div>
  );
}

/** A color swatch that can be switched off when `nullable` (stored as null). */
export function ColorField({
  label,
  value,
  nullable,
  disabled,
  onChange,
}: {
  label: string;
  value: string | null;
  nullable?: boolean;
  disabled?: boolean;
  onChange(value: string | null): void;
}) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [last, setLast] = useState(value ?? '#ffffff');
  useEffect(() => {
    if (value) setLast(value);
  }, [value]);
  // React's onChange fires on every move of the picker; the native change event fires once it closes,
  // so one pick is one undo step.
  const commit = useRef(onChange);
  commit.current = onChange;
  useEffect(() => {
    const input = ref.current;
    const onNativeChange = () => input && commit.current(input.value);
    input?.addEventListener('change', onNativeChange);
    return () => input?.removeEventListener('change', onNativeChange);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm text-slate-700">
      {nullable && (
        <input type="checkbox" aria-label={`Use ${label.toLowerCase()}`} checked={value !== null} disabled={disabled} onChange={(e) => onChange(e.target.checked ? last : null)} />
      )}
      <input
        id={id}
        ref={ref}
        type="color"
        className="h-7 w-10 cursor-pointer rounded border border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
        value={last}
        disabled={disabled || value === null}
        onChange={(e) => setLast(e.target.value)}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}
