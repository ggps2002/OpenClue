import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';
import { formatDuration } from '../../lib/format';
import { EXPORT_OPTIONS, exportsApi, MAX_GIF_MS, type ExportFormat, type ExportItem } from './exports.api';

const FORMATS: { value: ExportFormat; label: string; hint: string }[] = [
  { value: 'mp4', label: 'Video (MP4)', hint: 'Picture and sound, plays everywhere.' },
  { value: 'gif', label: 'Animated GIF', hint: 'No sound; for docs, chats and READMEs.' },
];

/** Picks a format and size and queues a render of the saved edit. */
export function ExportForm({ projectId, durationMs, onCreated }: { projectId: string; durationMs: number; onCreated(item: ExportItem): void }) {
  const id = useId();
  const [format, setFormat] = useState<ExportFormat>('mp4');
  const [quality, setQuality] = useState(EXPORT_OPTIONS.mp4[0].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const gifTooLong = format === 'gif' && durationMs > MAX_GIF_MS;

  const pickFormat = (next: ExportFormat) => {
    setFormat(next);
    setQuality(EXPORT_OPTIONS[next][0].value);
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await exportsApi.create(projectId, format, quality));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the export');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold text-slate-900">
          New export
        </h2>
        <p className="mt-1 text-sm text-slate-600">Renders the last saved edit ({formatDuration(durationMs)}). You can leave this page while it runs.</p>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-slate-600">Format</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {FORMATS.map((f) => (
            <label
              key={f.value}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${format === f.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300'}`}
            >
              <input type="radio" name={`${id}-format`} value={f.value} checked={format === f.value} onChange={() => pickFormat(f.value)} />
              <span>
                <span className="block font-medium text-slate-900">{f.label}</span>
                <span className="block text-slate-600">{f.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${id}-quality`} className="text-xs font-medium text-slate-600">
          Size
        </label>
        <select
          id={`${id}-quality`}
          className="mt-1 block w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-indigo-500 focus:outline-none sm:w-64"
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
        >
          {EXPORT_OPTIONS[format].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {gifTooLong && <Alert>GIFs can be at most {MAX_GIF_MS / 1000} seconds long. Export an MP4, or shorten the edit.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Button onClick={() => void submit()} disabled={busy || gifTooLong}>
        {busy ? 'Starting…' : 'Export'}
      </Button>
    </section>
  );
}
