import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { voiceoverApi, type GenerateScope, type Voiceover } from './voiceover.api';

/** What is being voiced right now: the whole script, one segment id, or nothing. */
export type VoiceoverBusy = { kind: 'all' } | { kind: 'segment'; segmentId: string } | null;

/** Loads a project's voiceover and the voice list, and runs generation requests. */
export function useVoiceover(projectId: string) {
  const state = useAsync(
    useCallback(async () => {
      const [voices, voiceover] = await Promise.all([voiceoverApi.voices(), voiceoverApi.get(projectId)]);
      return { voices, voiceover };
    }, [projectId]),
  );
  const [busy, setBusy] = useState<VoiceoverBusy>(null);
  const [error, setError] = useState<string>();
  const clipRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => clipRef.current?.pause(), []);

  const run = async (next: NonNullable<VoiceoverBusy>, request: () => Promise<Voiceover>) => {
    setBusy(next);
    setError(undefined);
    try {
      const voiceover = await request();
      state.setData((d) => d && { ...d, voiceover });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The voiceover could not be made');
      // A partial failure still saved the segments that worked.
      state.reload();
    } finally {
      setBusy(null);
    }
  };

  return {
    voices: state.data?.voices,
    voiceover: state.data?.voiceover ?? null,
    loadError: state.error,
    busy,
    error,
    generate: (voice: string, scope: GenerateScope) =>
      run({ kind: 'all' }, () => voiceoverApi.generate(projectId, voice, scope)),
    regenerateSegment: (segmentId: string) =>
      run({ kind: 'segment', segmentId }, () => voiceoverApi.regenerateSegment(projectId, segmentId)),
    /** Plays one segment's clip on its own, stopping any clip already playing. */
    playClip: (url: string) => {
      clipRef.current?.pause();
      clipRef.current = new Audio(url);
      void clipRef.current.play()?.catch(() => undefined);
    },
  };
}

export type VoiceoverState = ReturnType<typeof useVoiceover>;
