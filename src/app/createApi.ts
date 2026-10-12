import type { AppConfig } from '../config';
import type { LoopApi } from '../api/types';
import type { DemoStorage } from '../adapters/demo/backend';
import type { DemoState } from '../adapters/demo/state';

const DEMO_KEY = 'loop.demo.state.v3';

/** Synthetic demo state lives in this browser only (fictional data). */
function browserDemoStorage(): DemoStorage {
  return {
    load: () => {
      try {
        const raw = localStorage.getItem(DEMO_KEY);
        return raw ? (JSON.parse(raw) as DemoState) : null;
      } catch {
        return null;
      }
    },
    save: (s) => {
      try {
        localStorage.setItem(DEMO_KEY, JSON.stringify(s));
      } catch {
        /* storage full or blocked: demo keeps working in memory */
      }
    },
    clear: () => {
      try {
        localStorage.removeItem(DEMO_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Exactly one adapter per build/config. Demo and Supabase are never mixed. */
export async function createApi(config: AppConfig): Promise<LoopApi> {
  if (config.mode === 'demo') {
    let persona: string | null;
    try {
      persona = sessionStorage.getItem('loop.demo.persona');
    } catch {
      persona = null;
    }
    // Loaded lazily so a Supabase build never ships the synthetic adapter, and vice versa.
    const { DemoBackend } = await import('../adapters/demo/backend');
    const demo = new DemoBackend({ storage: browserDemoStorage() });
    try {
      if (persona) demo.setPersona(persona);
    } catch {
      /* unknown persona after reset */
    }
    return demo;
  }
  if (!config.supabase) throw new Error('Supabase configuration missing.');
  const { SupabaseApi } = await import('../adapters/supabase/supabaseApi');
  return new SupabaseApi(config.supabase.url, config.supabase.publishableKey);
}
