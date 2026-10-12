import { type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useApp } from './context';
import { DemoBanner } from './DemoControls';
import type { DemoBackend } from '../adapters/demo/backend';
import { purgeLocalDrafts } from '../lib/draftStore';

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold ${isActive ? 'bg-brand text-white' : 'text-brand hover:bg-brand-soft'}`}
    >
      {children}
    </NavLink>
  );
}

export function Shell() {
  const { api, viewer, config, bump } = useApp();
  const navigate = useNavigate();
  const isActiveAthlete = viewer?.athleteId && viewer.accountState === 'active';
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Skip to content
      </a>
      {api.kind === 'demo' ? <DemoBanner demo={api as unknown as DemoBackend} /> : null}
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <NavLink to="/" className="text-lg font-extrabold tracking-tight text-brand-strong">
            Loop<span className="text-accent">.</span>
          </NavLink>
          {viewer ? (
            <nav aria-label="Main" className="flex flex-wrap items-center gap-1">
              {viewer.athleteId ? (
                isActiveAthlete ? (
                  <>
                    <NavItem to="/home">Home</NavItem>
                    <NavItem to="/coaches">Coaches</NavItem>
                    <NavItem to="/profile">History</NavItem>
                  </>
                ) : (
                  <NavItem to="/pending">Activation</NavItem>
                )
              ) : null}
              {viewer.isGuardian ? <NavItem to="/guardian">Family</NavItem> : null}
              {viewer.isCoach ? <NavItem to="/coach">Coach</NavItem> : null}
              {viewer.isCoach && config.flags.teamTools ? <NavItem to="/coach/team">Team</NavItem> : null}
              {viewer.staffRoles.length ? <NavItem to="/admin">Admin</NavItem> : null}
              <NavItem to="/settings">Settings</NavItem>
              {api.kind === 'supabase' ? (
                <button
                  type="button"
                  className="min-h-11 px-3 text-sm font-semibold text-ink-soft underline"
                  onClick={async () => {
                    purgeLocalDrafts();
                    await api.signOut();
                    bump();
                    navigate('/welcome');
                  }}
                >
                  Sign out
                </button>
              ) : null}
            </nav>
          ) : null}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-2xl px-4 pb-16 pt-4">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-xs text-ink-soft">
        <p>
          Loop is a reflection notebook and a way to ask your own coach for one next step. It is not monitored around the clock and is not an
          emergency service. If someone is in danger, contact local emergency services.
        </p>
      </footer>
    </div>
  );
}
