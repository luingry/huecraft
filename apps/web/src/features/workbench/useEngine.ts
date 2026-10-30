import { useEffect, useState } from 'react';
import { EngineClient, type PreviewParams, type PreviewResult, type SourceImage } from '@huecraft/engine';

function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

/**
 * Keeps the source image resident in the engine worker and recomputes the
 * preview whenever the params change. The client is latest-wins, so rapid
 * slider drags never queue up stale work.
 */
export function useEngine(source: SourceImage | null, params: PreviewParams | null) {
  // Created in an effect (not during render) so StrictMode's mount/unmount/mount
  // cycle disposes and recreates it cleanly.
  const [client, setClient] = useState<EngineClient | null>(null);
  const [ready, setReady] = useState<{ client: EngineClient; source: SourceImage } | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new EngineClient();
    setClient(c);
    return () => c.dispose();
  }, []);

  useEffect(() => {
    if (!client) return;
    if (!source) {
      setReady(null);
      setResult(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    client.setImage(source).then(
      () => !cancelled && setReady({ client, source }),
      (e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, source]);

  useEffect(() => {
    if (!ready || ready.client !== client || ready.source !== source || !params) return;
    let cancelled = false;
    setBusy(true);
    ready.client.preview(params).then(
      (res) => {
        if (cancelled) return;
        setResult(res);
        setError(null);
        setBusy(false);
      },
      (e) => {
        if (cancelled || isAbort(e)) return;
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ready, client, source, params]);

  return { result, busy, error, client };
}
