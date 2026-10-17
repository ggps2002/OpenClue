import { useId, useState, type FormEvent } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/ApiClient';
import type { MediaAsset } from '../media/media.api';
import { scriptApi, type Script } from './script.api';

interface ScriptGeneratorProps {
  projectId: string;
  sources: MediaAsset[];
  defaultSourceId?: string | null;
  /** Shown when replacing an existing script. */
  replacing?: boolean;
  onGenerated(script: Script): void;
  onCancel?(): void;
}

/** Picks a project video/audio file and asks the server to transcribe it and write a script. */
export function ScriptGenerator({ projectId, sources, defaultSourceId, replacing, onGenerated, onCancel }: ScriptGeneratorProps) {
  const id = useId();
  const [mediaId, setMediaId] = useState(defaultSourceId ?? sources[0]?.id ?? '');
  const [retranscribe, setRetranscribe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mediaId) return;
    setBusy(true);
    setError(undefined);
    try {
      onGenerated(await scriptApi.generate(projectId, mediaId, retranscribe));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not write the script');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{replacing ? 'Write a new draft' : 'Write the script'}</h2>
        <p className="mt-1 text-sm text-slate-600">
          OpenClue transcribes what you said in the recording, removes the ums and restarts, and splits the narration
          into timed segments you can edit.
          {replacing && ' The new draft replaces the current script, including your edits.'}
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-source`} className="block text-sm font-medium text-slate-700">
          Recording to script
        </label>
        <select
          id={`${id}-source`}
          value={mediaId}
          onChange={(e) => setMediaId(e.target.value)}
          className="block w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        >
          {sources.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {replacing && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={retranscribe} onChange={(e) => setRetranscribe(e.target.checked)} />
          Transcribe the audio again
        </label>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !mediaId}>
          {busy ? 'Transcribing and writing…' : replacing ? 'Write new draft' : 'Write script'}
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
