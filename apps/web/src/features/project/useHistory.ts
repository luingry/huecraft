import { useCallback, useRef, useState } from 'react';

const COALESCE_MS = 700;
const LIMIT = 200;

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

/**
 * Undo/redo state. Consecutive updates with the same `coalesceKey` inside a
 * short window collapse into one step, so a slider drag is a single undo.
 */
export function useHistory<T>(initial: () => T) {
  const [h, setH] = useState<HistoryState<T>>(() => ({ past: [], present: initial(), future: [] }));
  const last = useRef<{ key: string | null; at: number }>({ key: null, at: 0 });

  /** `merge` folds the update into the current step (follow-ups the user never sees as their own action). */
  const set = useCallback((updater: (prev: T) => T, coalesceKey?: string, merge = false) => {
    const now = performance.now();
    const coalesce =
      merge || (coalesceKey !== undefined && last.current.key === coalesceKey && now - last.current.at < COALESCE_MS);
    last.current = { key: coalesceKey ?? null, at: now };
    setH((prev) => {
      const next = updater(prev.present);
      if (next === prev.present) return prev;
      if (coalesce) return { ...prev, present: next, future: [] };
      return { past: [...prev.past, prev.present].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  const undo = useCallback(() => {
    last.current = { key: null, at: 0 };
    setH((prev) =>
      prev.past.length === 0
        ? prev
        : { past: prev.past.slice(0, -1), present: prev.past[prev.past.length - 1], future: [prev.present, ...prev.future] },
    );
  }, []);

  const redo = useCallback(() => {
    last.current = { key: null, at: 0 };
    setH((prev) =>
      prev.future.length === 0
        ? prev
        : { past: [...prev.past, prev.present], present: prev.future[0], future: prev.future.slice(1) },
    );
  }, []);

  /** Replace state and clear history (e.g. when opening another project). */
  const reset = useCallback((state: T) => {
    last.current = { key: null, at: 0 };
    setH({ past: [], present: state, future: [] });
  }, []);

  return {
    state: h.present,
    set,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
