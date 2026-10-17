import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';
import { cn } from '../../lib/cn';
import { captionsApi, type CaptionPreset, type Captions } from './captions.api';
import { PresetSwatch } from './CaptionStylePanel';

interface CaptionsGeneratorProps {
  projectId: string;
  presets: CaptionPreset[];
  /** The captions being rebuilt, if any: their layout is the starting point and their style is kept by default. */
  current: Captions | null;
  hasVoiceover: boolean;
  onGenerated(captions: Captions): void;
  onCancel?(): void;
}

const inputClasses = 'mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none';

/** Options for building captions from the script: line length, lines per caption and (the first time) a preset. */
export function CaptionsGenerator({ projectId, presets, current, hasVoiceover, onGenerated, onCancel }: CaptionsGeneratorProps) {
  const id = useId();
  const [maxCharsPerLine, setMaxChars] = useState(current?.maxCharsPerLine ?? 42);
  const [maxLines, setMaxLines] = useState<1 | 2>(current?.maxLines ?? 2);
  const [preset, setPreset] = useState<string | null>(current ? null : (presets[0]?.id ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onGenerated(await captionsApi.generate(projectId, { maxCharsPerLine, maxLines, preset: preset ?? undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.issues[0]?.message ?? err.message) : 'Could not make the captions');
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="max-w-2xl space-y-5 rounded-xl border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{current ? 'Rebuild captions from the script' : 'Make captions from the script'}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {hasVoiceover
            ? 'Each caption is timed to the voiceover, so it appears while its words are spoken.'
            : 'There is no voiceover yet, so each caption fills its script segment. Generate the voiceover first for tighter timing.'}
          {current && ' Rebuilding replaces your edited captions.'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor={`${id}-chars`} className="text-xs font-medium text-slate-600">
            Characters per line
          </label>
          <input id={`${id}-chars`} type="number" min={16} max={80} className={inputClasses} value={maxCharsPerLine} onChange={(e) => setMaxChars(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor={`${id}-lines`} className="text-xs font-medium text-slate-600">
            Lines per caption
          </label>
          <select id={`${id}-lines`} className={inputClasses} value={maxLines} onChange={(e) => setMaxLines(e.target.value === '1' ? 1 : 2)}>
            <option value={2}>Up to two</option>
            <option value={1}>One</option>
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Style</legend>
        <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {current && (
            <PresetChoice label="Keep current" selected={preset === null} onSelect={() => setPreset(null)}>
              <span className="flex h-12 items-center justify-center rounded-md bg-slate-100 text-xs text-slate-500">As is</span>
            </PresetChoice>
          )}
          {presets.map((p) => (
            <PresetChoice key={p.id} label={p.label} title={p.description} selected={preset === p.id} onSelect={() => setPreset(p.id)}>
              <PresetSwatch preset={p} />
            </PresetChoice>
          ))}
        </div>
      </fieldset>
      {error && <Alert>{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !(maxCharsPerLine >= 16 && maxCharsPerLine <= 80)}>
          {busy ? 'Making captions…' : current ? 'Rebuild captions' : 'Make captions'}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function PresetChoice({ label, title, selected, onSelect, children }: { label: string; title?: string; selected: boolean; onSelect(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn('rounded-lg border p-1 text-xs font-medium text-slate-700', selected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300')}
    >
      {children}
      <span className="mt-1 block">{label}</span>
    </button>
  );
}
