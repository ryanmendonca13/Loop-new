/**
 * Runtime configuration from Vite env. The adapter is chosen explicitly; there is no default and no
 * fallback, so demo and real data can never be silently mixed.
 */
import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');

const envSchema = z.object({
  VITE_APP_MODE: z.enum(['demo', 'supabase'], { message: 'VITE_APP_MODE must be "demo" or "supabase".' }),
  VITE_DEPLOY_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  VITE_SUPABASE_URL: z.string().optional(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  VITE_FLAG_TEAM_TOOLS: flag,
  VITE_FLAG_DIRECTOR_VIEW: flag,
  VITE_FLAG_VOICE: flag,
  VITE_FLAG_BILLING: flag,
});

export interface AppConfig {
  mode: 'demo' | 'supabase';
  deployEnv: 'development' | 'staging' | 'production';
  supabase: { url: string; publishableKey: string } | null;
  flags: { teamTools: boolean; directorView: boolean; voice: boolean; billing: boolean };
}

/** Rejects keys that must never reach a browser (service role JWTs, secret keys). */
export function looksLikeSecretKey(key: string): boolean {
  if (/^sb_secret_/.test(key) || /^sk_(live|test)_/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string };
      return payload.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

export function parseConfig(env: Record<string, unknown>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  const e = parsed.data;
  if (e.VITE_APP_MODE === 'demo' && e.VITE_DEPLOY_ENV === 'production') {
    throw new Error('Refusing to run the synthetic demo adapter with VITE_DEPLOY_ENV=production.');
  }
  let supabase: AppConfig['supabase'] = null;
  if (e.VITE_APP_MODE === 'supabase') {
    if (!e.VITE_SUPABASE_URL) throw new Error('VITE_SUPABASE_URL is required in supabase mode.');
    if (!/^https:\/\//.test(e.VITE_SUPABASE_URL) && e.VITE_DEPLOY_ENV !== 'development') {
      throw new Error('VITE_SUPABASE_URL must be an https URL outside development.');
    }
    if (!e.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY is required in supabase mode.');
    if (looksLikeSecretKey(e.VITE_SUPABASE_PUBLISHABLE_KEY)) {
      throw new Error('Refusing to start: a secret/service-role key was supplied as the browser key.');
    }
    supabase = { url: e.VITE_SUPABASE_URL, publishableKey: e.VITE_SUPABASE_PUBLISHABLE_KEY };
  }
  const production = e.VITE_DEPLOY_ENV === 'production';
  return {
    mode: e.VITE_APP_MODE,
    deployEnv: e.VITE_DEPLOY_ENV,
    supabase,
    flags: {
      // P1 features stay closed in production until the owner approves them (see docs/PRODUCTION_READINESS.md).
      teamTools: e.VITE_FLAG_TEAM_TOOLS && !production,
      directorView: e.VITE_FLAG_DIRECTOR_VIEW && !production,
      voice: e.VITE_FLAG_VOICE,
      billing: e.VITE_FLAG_BILLING && !production,
    },
  };
}
