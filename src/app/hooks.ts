import { useCallback, useEffect, useRef, useState } from 'react';
import { isDomainError } from '../domain';
import { useApp } from './context';

export function errorMessage(e: unknown): string {
  if (isDomainError(e)) return e.message;
  return 'Something went wrong. Please try again.';
}

/** Loads data for a screen and reloads after mutations. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current().then(
      (d) => {
        if (!alive) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** Runs a mutation with busy/error state and refreshes data on success. Guards against double submit. */
export function useAction() {
  const { bump } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (inflight.current) return undefined;
      inflight.current = true;
      setBusy(true);
      setError(null);
      try {
        const out = await fn();
        bump();
        return out;
      } catch (e) {
        setError(errorMessage(e));
        return undefined;
      } finally {
        inflight.current = false;
        setBusy(false);
      }
    },
    [bump],
  );
  return { run, busy, error, setError };
}
