import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LoopApi, Viewer } from '../api/types';
import type { AppConfig } from '../config';

interface Ctx {
  api: LoopApi;
  config: AppConfig;
  viewer: Viewer | null;
  viewerLoaded: boolean;
  refreshViewer: () => Promise<Viewer | null>;
  /** Bumps after every successful mutation so screens can reload. */
  version: number;
  bump: () => void;
}

const ApiContext = createContext<Ctx | null>(null);

export function ApiProvider({ api, config, children }: { api: LoopApi; config: AppConfig; children: ReactNode }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [viewerLoaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const refreshViewer = useCallback(async () => {
    try {
      const v = await api.getViewer();
      setViewer(v);
      return v;
    } finally {
      setLoaded(true);
    }
  }, [api]);
  useEffect(() => {
    void refreshViewer();
  }, [refreshViewer, version]);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const value = useMemo(() => ({ api, config, viewer, viewerLoaded, refreshViewer, version, bump }), [api, config, viewer, viewerLoaded, refreshViewer, version, bump]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApp(): Ctx {
  const c = useContext(ApiContext);
  if (!c) throw new Error('useApp outside ApiProvider');
  return c;
}
