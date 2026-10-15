import { useCallback, useEffect, useState } from 'react';

interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** Re-runs the loader, keeping the current data visible while it loads. */
  reload(): void;
  /** Replaces the data locally, e.g. after a mutation that returned the new value. */
  setData(update: (current: T | undefined) => T | undefined): void;
}

/** Runs `load` on mount and whenever its identity changes (wrap it in useCallback). */
export function useAsync<T>(load: () => Promise<T>): AsyncState<T> {
  const [data, setDataState] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .then((value) => {
        if (!active) return;
        setDataState(value);
        setError(undefined);
      })
      .catch((err: unknown) => active && setError(err instanceof Error ? err : new Error(String(err))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [load, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback((update: (current: T | undefined) => T | undefined) => setDataState(update), []);
  return { data, error, loading, reload, setData };
}
