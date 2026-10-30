import { useCallback, useEffect, useRef, useState } from 'react';
import type { PipelineInput, PipelineResult } from '@huecraft/engine';
import { createEngineWorker, runInWorker } from '@huecraft/engine';

export type LoadingStage = 'idle' | 'decoding' | 'computing' | 'exporting';

export function useEnginePipeline() {
  const workerRef = useRef<Worker | null>(null);
  const runIdRef = useRef(0);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [stage, setStage] = useState<LoadingStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const loading = stage !== 'idle';

  useEffect(() => {
    workerRef.current = createEngineWorker();
    return () => workerRef.current?.terminate();
  }, []);

  const run = useCallback((input: PipelineInput, fast = false) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const delay = fast ? 80 : 300;
    setStage('computing');
    setError(null);
    debounceRef.current = setTimeout(async () => {
      const worker = workerRef.current;
      if (!worker) return;
      const id = ++runIdRef.current;
      try {
        const res = await runInWorker(worker, {
          ...input,
          previewMaxEdge: fast ? 256 : 512,
          skipExport: fast,
        });
        if (id !== runIdRef.current) return;
        setResult(res);
      } catch (e) {
        if (id !== runIdRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === runIdRef.current) setStage('idle');
      }
    }, delay);
  }, []);

  const runFull = useCallback(async (input: PipelineInput): Promise<PipelineResult> => {
    const worker = workerRef.current;
    if (!worker) throw new Error('Engine worker not ready');
    const id = ++runIdRef.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setStage('exporting');
    setError(null);
    try {
      const res = await runInWorker(worker, {
        ...input,
        previewMaxEdge: 512,
        skipExport: false,
      });
      if (id !== runIdRef.current) return res;
      setResult(res);
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (id === runIdRef.current) setError(msg);
      throw e;
    } finally {
      if (id === runIdRef.current) setStage('idle');
    }
  }, []);

  return { result, loading, stage, error, run, runFull };
}
