/**
 * DEMO MODE ONLY. Persistent banner and role switcher for synthetic personas. This file is only
 * imported when the demo adapter is active and is never authorization in production: the Supabase
 * adapter has no persona concept and derives identity solely from the verified JWT.
 */
import { useId } from 'react';
import { useNavigate } from 'react-router';
import type { DemoBackend } from '../adapters/demo/backend';
import { purgeLocalDrafts } from '../lib/draftStore';
import { useApp } from './context';

export function DemoBanner({ demo }: { demo: DemoBackend }) {
  const { viewer, bump } = useApp();
  const id = useId();
  const navigate = useNavigate();
  const personas = demo.listPersonas();
  return (
    <div role="region" aria-label="Demo mode" className="sticky top-0 z-20 border-b-2 border-accent bg-accent-soft px-4 py-2 text-sm text-ink">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2">
        <p className="font-bold">
          <span className="mr-1 rounded bg-accent px-1.5 py-0.5 text-xs uppercase tracking-wide text-white">Demo</span>
          Synthetic data · fictional people · nothing is sent
        </p>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label htmlFor={id} className="shrink-0 font-semibold">
            View as
          </label>
          <select
            id={id}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-line bg-white px-2"
            value={viewer?.userId ?? ''}
            onChange={(e) => {
              purgeLocalDrafts();
              demo.setPersona(e.target.value || null);
              try {
                sessionStorage.setItem('loop.demo.persona', e.target.value);
              } catch {
                /* ignore */
              }
              bump();
              navigate('/');
            }}
          >
            <option value="">Signed out</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} — {p.persona}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-md px-2 font-semibold text-accent underline"
          onClick={() => {
            if (!window.confirm('Reset all synthetic demo data?')) return;
            demo.reset();
            purgeLocalDrafts();
            bump();
            navigate('/');
          }}
        >
          Reset demo
        </button>
      </div>
    </div>
  );
}
