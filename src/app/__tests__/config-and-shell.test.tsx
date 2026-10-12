import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { parseConfig, looksLikeSecretKey } from '../../config';
import { ApiProvider } from '../context';
import { AppRoutes } from '../routes';
import { DemoBackend } from '../../adapters/demo/backend';
import { DEMO_IDS } from '../../adapters/demo/fixtures';
import type { LoopApi } from '../../api/types';

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');

describe('config', () => {
  it('requires an explicit adapter and refuses demo in production', () => {
    expect(() => parseConfig({})).toThrow(/VITE_APP_MODE/);
    expect(() => parseConfig({ VITE_APP_MODE: 'demo', VITE_DEPLOY_ENV: 'production' })).toThrow(/demo/);
    expect(parseConfig({ VITE_APP_MODE: 'demo' }).mode).toBe('demo');
  });
  it('refuses service-role or secret keys in the browser', () => {
    const serviceJwt = `x.${b64({ role: 'service_role' })}.y`;
    expect(looksLikeSecretKey(serviceJwt)).toBe(true);
    expect(looksLikeSecretKey('sb_secret_abc')).toBe(true);
    expect(looksLikeSecretKey('sb_publishable_abc')).toBe(false);
    expect(() => parseConfig({ VITE_APP_MODE: 'supabase', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: serviceJwt })).toThrow(/secret/);
  });
  it('keeps P1 flags closed in production', () => {
    const c = parseConfig({ VITE_APP_MODE: 'supabase', VITE_DEPLOY_ENV: 'production', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', VITE_FLAG_TEAM_TOOLS: 'true', VITE_FLAG_BILLING: 'true' });
    expect(c.flags.teamTools).toBe(false);
    expect(c.flags.billing).toBe(false);
  });
});

describe('demo banner and role switcher', () => {
  it('render only for the demo adapter', async () => {
    const demo = new DemoBackend({ actorId: DEMO_IDS.avaT });
    const config = parseConfig({ VITE_APP_MODE: 'demo' });
    const { unmount } = render(<MemoryRouter initialEntries={['/welcome']}><ApiProvider api={demo} config={config}><AppRoutes /></ApiProvider></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'Demo mode' })).toBeInTheDocument();
    expect(screen.getByLabelText('View as')).toBeInTheDocument();
    unmount();

    // A non-demo adapter (shape of SupabaseApi) never gets a banner or switcher.
    const fake = { ...Object.fromEntries(Object.getOwnPropertyNames(DemoBackend.prototype).map((k) => [k, async () => null])), kind: 'supabase' } as unknown as LoopApi;
    render(<MemoryRouter initialEntries={['/welcome']}><ApiProvider api={fake} config={parseConfig({ VITE_APP_MODE: 'supabase', VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })}><AppRoutes /></ApiProvider></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Demo mode' })).toBeNull();
    expect(screen.queryByLabelText('View as')).toBeNull();
  });
});
