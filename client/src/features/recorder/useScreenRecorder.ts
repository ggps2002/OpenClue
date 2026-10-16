import { useCallback, useEffect, useState } from 'react';
import { ScreenRecorder, type RecorderState, type RecordingResult, type StartOptions } from './ScreenRecorder';

/** Turns a getDisplayMedia/getUserMedia failure into something a person can act on. */
export function describeCaptureError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') return 'Screen or microphone access was cancelled or blocked. Allow access and try again.';
    if (err.name === 'NotFoundError') return 'No microphone was found. Turn off “Record microphone” or connect one.';
    if (err.name === 'NotReadableError') return 'Your screen or microphone is in use by another app.';
  }
  return err instanceof Error ? err.message : 'Recording could not start';
}

/** React bindings for one ScreenRecorder: live state, elapsed time, click count and the result. */
export function useScreenRecorder() {
  const [recorder] = useState(() => new ScreenRecorder());
  const [state, setState] = useState<RecorderState>(recorder.state);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [clickCount, setClickCount] = useState(0);
  const [result, setResult] = useState<RecordingResult | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const unsubscribe = recorder.subscribe(setState);
    return () => {
      unsubscribe();
      recorder.cancel();
    };
  }, [recorder]);

  useEffect(() => {
    if (state !== 'recording') return;
    const id = window.setInterval(() => {
      setElapsedMs(recorder.elapsedMs());
      setClickCount(recorder.clickCount);
    }, 250);
    return () => window.clearInterval(id);
  }, [state, recorder]);

  // Covers both the Stop button and the browser's own "Stop sharing" control.
  useEffect(() => {
    if (state !== 'stopped') return;
    let active = true;
    void recorder.stop().then((value) => {
      if (!active) return;
      setResult(value);
      setElapsedMs(value.durationMs);
      setClickCount(value.clicks.length);
    });
    return () => {
      active = false;
    };
  }, [state, recorder]);

  const start = useCallback(
    async (options: StartOptions) => {
      setError(undefined);
      setResult(null);
      setElapsedMs(0);
      setClickCount(0);
      try {
        await recorder.start(options);
      } catch (err) {
        setError(describeCaptureError(err));
      }
    },
    [recorder],
  );

  const discard = useCallback(() => {
    recorder.cancel();
    setResult(null);
    setElapsedMs(0);
    setClickCount(0);
  }, [recorder]);

  return {
    state,
    elapsedMs,
    clickCount,
    result,
    error,
    start,
    pause: useCallback(() => recorder.pause(), [recorder]),
    resume: useCallback(() => recorder.resume(), [recorder]),
    stop: useCallback(() => void recorder.stop().catch(() => undefined), [recorder]),
    discard,
  };
}
