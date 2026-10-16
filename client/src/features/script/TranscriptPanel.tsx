import { useState } from 'react';
import { ApiError } from '../../lib/ApiClient';
import { formatDuration } from '../../lib/format';
import { scriptApi, type Transcript } from './script.api';

/** Collapsible view of the raw transcript the script was written from; loads on first open. */
export function TranscriptPanel({ mediaId }: { mediaId: string }) {
  const [transcript, setTranscript] = useState<Transcript>();
  const [error, setError] = useState<string>();

  const handleToggle = (open: boolean) => {
    if (!open || transcript) return;
    scriptApi
      .transcript(mediaId)
      .then(setTranscript)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Could not load the transcript'));
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4" onToggle={(e) => handleToggle(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium text-slate-800">Original narration</summary>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {!transcript && !error && <p className="mt-2 text-sm text-slate-500">Loading…</p>}
      {transcript && (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm text-slate-700">
          {transcript.segments.map((s) => (
            <li key={s.startMs}>
              <span className="mr-2 font-mono text-xs text-slate-500">{formatDuration(s.startMs)}</span>
              {s.text}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
