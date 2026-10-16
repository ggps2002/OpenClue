import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { formatDuration } from '../../lib/format';
import { syncTrack } from './syncTrack';
import type { VoiceoverState } from './useVoiceover';

interface VoiceoverPanelProps {
  state: VoiceoverState;
  mediaRef: RefObject<HTMLMediaElement>;
  canEdit: boolean;
  /** Unsaved script edits: the voiceover is made from the saved script, so generation waits for a save. */
  dirty: boolean;
}

/** Voice picker, generate/update buttons and the "hear it with the video" toggle. */
export function VoiceoverPanel({ state, mediaRef, canEdit, dirty }: VoiceoverPanelProps) {
  const { voices, voiceover, busy, error } = state;
  const id = useId();
  const [voice, setVoice] = useState<string>();
  const [listen, setListen] = useState(false);
  const trackRef = useRef<HTMLAudioElement>(null);

  const selected = voice ?? voiceover?.voice ?? voices?.defaultVoice ?? '';
  const pending = voiceover
    ? voiceover.segments.filter((s) => s.status === 'missing' || s.status === 'stale').length
    : 0;
  const voiceChanged = Boolean(voiceover && selected !== voiceover.voice);
  const trackUrl = voiceover?.trackUrl;

  useEffect(() => {
    const media = mediaRef.current;
    const track = trackRef.current;
    if (!listen || !media || !track || !trackUrl) return;
    return syncTrack(media, track);
  }, [listen, trackUrl, mediaRef]);

  if (state.loadError) return <Alert>Could not load the voiceover: {state.loadError.message}</Alert>;
  if (!voices) return null;

  const generating = busy !== null;
  let action: { label: string; scope: 'all' | 'changed' } | null = null;
  if (!voiceover) action = { label: 'Generate voiceover', scope: 'changed' };
  else if (voiceChanged || pending > 0) action = { label: voiceChanged ? 'Re-voice with this voice' : `Update ${pending} changed`, scope: 'changed' };

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-slate-900">
          AI voiceover
        </h2>
        {voiceover?.trackUrl && (
          <span className="text-xs text-slate-500">{formatDuration(voiceover.trackDurationMs)} of narration</span>
        )}
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <span className="flex min-w-40 flex-1 flex-col gap-1">
            <label htmlFor={`${id}-voice`} className="text-xs font-medium text-slate-600">
              Voice
            </label>
            <select
              id={`${id}-voice`}
              value={selected}
              onChange={(e) => setVoice(e.target.value)}
              disabled={generating}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            >
              {voices.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.description}
                </option>
              ))}
            </select>
          </span>
          {action && (
            <Button onClick={() => void state.generate(selected, action.scope)} disabled={generating || dirty}>
              {busy?.kind === 'all' ? 'Voicing…' : action.label}
            </Button>
          )}
          {voiceover && !action && (
            <Button variant="secondary" onClick={() => void state.generate(selected, 'all')} disabled={generating || dirty}>
              {busy?.kind === 'all' ? 'Voicing…' : 'Re-voice all'}
            </Button>
          )}
        </div>
      )}

      {canEdit && dirty && <p className="text-xs text-slate-600">Save your script edits to update the voiceover.</p>}
      {!voiceover && !canEdit && <p className="text-sm text-slate-600">No voiceover has been made for this script yet.</p>}
      {voiceover && !action && <p className="text-xs text-emerald-700">Every segment is voiced and up to date.</p>}
      {(voices.mode === 'offline' || voiceover?.offline) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Offline mode: no speech key is configured on the server, so each segment gets silent audio of the right length.
          Timing and sync work the same; add an OpenAI key to hear real voices.
        </p>
      )}
      {error && <Alert>{error}</Alert>}

      {trackUrl && (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={listen} onChange={(e) => setListen(e.target.checked)} />
            Hear the voiceover with the video
          </label>
          <audio ref={trackRef} src={trackUrl} preload="auto" className="hidden" aria-hidden="true" />
        </>
      )}
    </section>
  );
}
