import { useCallback, useState } from 'react';
import type { Timeline } from './Timeline';

const MAX_HISTORY = 100;

interface History {
  past: Timeline[];
  present: Timeline;
  future: Timeline[];
}

/** Undo/redo over immutable Timeline values. Edits that return the same Timeline are ignored. */
export function useTimelineHistory(initial: Timeline) {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });

  const apply = useCallback((edit: (timeline: Timeline) => Timeline) => {
    setHistory((h) => {
      const next = edit(h.present);
      if (next === h.present) return h;
      return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const previous = h.past.at(-1);
      return previous ? { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] } : h;
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      const [next, ...future] = h.future;
      return next ? { past: [...h.past, h.present], present: next, future } : h;
    });
  }, []);

  return {
    timeline: history.present,
    apply,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
