# Security self-review (Pass 5)

This is an internal engineering review, **not** an independent audit.

| Area | Finding | Status |
|---|---|---|
| Authority | Identity comes from the JWT (`auth.uid()`). No RPC accepts a client-supplied owner, role or actor id as authority. Athlete id is derived via `app.my_athlete_id()`. | OK |
| RLS | Every public table has RLS and SELECT-only grants. The DB test checks no table lacks RLS. | OK (verify on hosted) |
| SECURITY DEFINER | All functions use `set search_path = ''` and fully-qualified names. Default EXECUTE revoked from PUBLIC/anon/authenticated, explicit grants only. Service-only functions (`expire_due_requests`, `process_deletion`, `billing_*`) callable only by `service_role`. | OK |
| Service role | Used only in `stripe-webhook` (after signature check), `notify-dispatch`, `expire-requests`, `data-rights` (shared-secret protected). `ai-draft` runs with the coach's JWT. | OK; rotate `CRON_SECRET`/`OPS_SECRET` |
| Tokens | 256-bit, SHA-256 stored, single use, expiring, email-bound, in URL fragment, cleared from history after reading, redemption rate-limited. | OK |
| Content separation | Diary, shared snapshot, drafts/notes, publications and cues are in separate tables with separate policies. | OK |
| Revocation | Affects new reads immediately (policies check live link/relationship state). UI states already-viewed content cannot be recalled. | OK |
| Audit | Append-only (trigger even for owner). Forbidden-key check in SQL and TS. **Risk:** `evidence_ref` is free text; reviewers must use opaque references, not names. | Procedure needed |
| Injection | Parameterised RPCs only. No dynamic SQL with user input. React escaping; no raw HTML (lint rule). | OK |
| AI | Server-only. Minimal sources for one request. Untrusted text fenced. Zod-validated with exact athlete and source ids. Quote, diagnosis and certainty checks. Cannot publish, accept focus or change access. | OK; red-team with real model before enabling |
| Secrets | `.env*` ignored except secret-free mode files. Vite refuses `VITE_` secrets. App refuses service-role or secret keys. Server refuses Stripe live keys and SMS. | OK |
| Headers | CSP, HSTS, nosniff, frame-deny, no-referrer, permissions policy (`vercel.json`). | OK for Vercel |
| DoS / growth | `rate_limits` and `notification_jobs` grow without purge jobs. | Gap (KNOWN_GAPS #9) |
| Demo adapter | Mirrors rules but is client-side. **Not a security boundary.** Refused when `VITE_DEPLOY_ENV=production`. | By design |
