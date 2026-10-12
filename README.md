# Loop Athlete

> **Your reflection. One next step. Feedback from the coach you trust.**

Athlete-led reflection-to-action app. An athlete reflects in about 90 seconds and chooses one NEXT action. They can ask the real coach they trust for one concrete response. The athlete can start without a club or team.

**Status: synthetic pilot build. NOT production-ready.** It builds and its tests pass, but that does not make it production-ready. Production stays gated by [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) and the owner decisions in [`DECISIONS.md`](DECISIONS.md).

## Stack

| Layer | Choice |
|---|---|
| UI | TypeScript, React 19, Vite 8, Tailwind 4, React Router 8 (mobile-first web app, no app store) |
| Validation | Zod 4 (shared by browser, demo adapter and Edge Functions) |
| Backend | Supabase: Auth, Postgres with RLS, private Storage, Edge Functions (Deno) |
| Tests | Vitest (unit and component), Vitest with PostgreSQL 16 (RLS/RPC integration), Playwright with axe (end-to-end, accessibility, mobile) |

All dependencies are pinned exactly, with `package-lock.json` committed. TypeScript stays on 6.0.x because `typescript-eslint` does not support 7.x yet.

## Layout

```
src/domain/          Pure domain: types, Zod schemas, state machines, authorization policies, solo ABZ,
                     AI contract, billing reconciliation, notifications, aggregates. No React/Supabase imports (lint-enforced).
src/api/types.ts     Adapter contract (LoopApi) used by the UI.
src/adapters/demo/   Synthetic in-browser backend (fictional data, no network effects, role switcher).
src/adapters/supabase/ Real adapter: Supabase Auth JWT + RLS reads + SECURITY DEFINER RPC writes.
src/screens, src/ui  Screens and accessible reusable components.
supabase/migrations  Schema, constraints, RLS, RPCs, storage policies (version-controlled SQL).
supabase/functions   Edge Functions: ai-draft, stripe-webhook, billing-session, notify-dispatch, expire-requests, data-rights.
supabase/seed.sql    Synthetic local seed, run through the real RPCs.
tests/db             RLS/RPC integration tests against PostgreSQL 16 with a Supabase shim.
e2e                  Playwright: demo script, guards, axe and overflow checks at 320/390px.
docs/                Architecture, readiness checklist, demo script, test results, known gaps, runbook.
```

## Quick start (synthetic demo, no accounts needed)

```bash
npm ci
npm run dev            # http://localhost:5173, uses .env.development (VITE_APP_MODE=demo)
```

Use **View as** in the orange Demo banner to switch between fictional personas. The switcher exists only in demo mode. See [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

## Tests

```bash
npm run typecheck && npm run lint
npm run test:unit                 # domain, demo adapter, Edge Function logic, config/shell
npm run db:local                  # throwaway PostgreSQL 16 on :54329 (no Docker); or set TEST_DATABASE_URL
npm run test:db                   # RLS/RPC integration (creates and drops its own databases)
npm run test:e2e                  # builds the demo bundle, then runs Playwright
```

Latest results are in [`docs/TEST_RESULTS.md`](docs/TEST_RESULTS.md).

## Real Supabase setup (owner does this; nothing is deployed here)

1. Create **separate** Supabase projects for staging and production. Never test against production.
2. Run `supabase link`, then `supabase db push` (applies `supabase/migrations`). Use `supabase/seed.sql` for **local only**.
3. Set Edge Function secrets with `supabase secrets set ...`, using the names in `.env.example`. Server-only values never go in `VITE_*` variables. `vite.config.ts` refuses to build if they do, and the app refuses service-role or secret keys as the browser key.
4. Deploy the functions with `supabase functions deploy <name>`. Schedule `expire-requests` and `notify-dispatch` with a `CRON_SECRET`.
5. Frontend (Vercel-compatible): build with `npm run build` and `VITE_APP_MODE=supabase`, `VITE_DEPLOY_ENV=staging|production`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. `vercel.json` sets the security headers and the SPA rewrite.
6. Grant staff roles (`staff_roles`) only to people who have MFA enrolled. Staff RPCs require `aal2`.

Before inviting any real user, read [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

## Hard boundaries in this build

- No public deployment, real messages, charges, legacy imports or real minors' data.
- AI runs only server-side, uses a mock until configured, and produces private drafts only. AI action recommendations are **off**.
- SMS is disabled (the server refuses `SMS_ENABLED=true`).
- Stripe accepts **test keys only** and is off by default. No prices are configured.
- Voice transcription is simulated and labelled in demo mode. The production transcription adapter is off.
