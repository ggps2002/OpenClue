import { useCallback, useEffect } from 'react';
import { ApiError } from '../../lib/ApiClient';
import { useAsync } from '../../lib/useAsync';
import { exportsApi, isActive, type ExportItem } from './exports.api';

export const POLL_MS = 1000;
const GONE = 'gone';

/** Loads a project's exports and keeps polling the ones still rendering until they finish. */
export function useExports(projectId: string) {
  const list = useAsync(useCallback(() => exportsApi.list(projectId), [projectId]));
  const { setData, reload } = list;
  const activeIds = (list.data?.exports ?? []).filter(isActive).map((e) => e.id).join(',');

  useEffect(() => {
    if (!activeIds) return;
    let stopped = false;
    const timer = setInterval(() => {
      const ids = activeIds.split(',');
      // A 404 means someone else deleted it; other errors are retried on the next tick.
      void Promise.all(ids.map((id) => exportsApi.get(id).catch((err: unknown) => (err instanceof ApiError && err.status === 404 ? GONE : null)))).then(
        (updates) => {
          if (stopped) return;
          const gone = new Set(ids.filter((_, i) => updates[i] === GONE));
          const byId = new Map(updates.filter((u): u is ExportItem => u !== null && u !== GONE).map((u) => [u.id, u]));
          // A finished render adds minutes, so refresh the usage line too.
          if ([...byId.values()].some((u) => u.status === 'done')) reload();
          else setData((d) => d && { ...d, exports: d.exports.filter((e) => !gone.has(e.id)).map((e) => byId.get(e.id) ?? e) });
        },
      );
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [activeIds, setData, reload]);

  const add = (item: ExportItem) => setData((d) => d && { ...d, exports: [item, ...d.exports] });
  const drop = (id: string) => setData((d) => d && { ...d, exports: d.exports.filter((e) => e.id !== id) });
  return { ...list, add, drop };
}
