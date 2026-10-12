# Test results

Run on 2026-10-12 in the build container (Node 22.22, PostgreSQL 16, Chromium 141 build 1194). Every number below comes from a command that was actually run.

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc -b`) | ✅ no errors |
| `npm run lint` (ESLint 10 + typescript-eslint + react-hooks) | ✅ no errors |
| `npm run test:unit` | ✅ 5 files, **65 tests passed** |
| `npm run test:db` | ✅ 3 files, **51 tests passed** |
| `npm run test:e2e` (Playwright, 390px project) | ✅ **15 passed** |
| `npm run build:demo` | ✅ built |
| `npm audit` | ✅ 0 vulnerabilities |

## What the suites cover

**Unit** (`src/**/__tests__`, `supabase/functions/_shared`):
- Exact prompts; missing mood stays null; input limits.
- State machine transitions, and active request states matching the DB index.
- Pilot activation gaps (adult, minor, under-13).
- Rule of Two gates, audience hashing, shared-exchange read rules.
- Invites: replay, expiry, revocation, email mismatch, forged token.
- Solo ABZ uses the athlete's words only; audit metadata redaction.
- Aggregates: canceled sessions and inactive memberships excluded; complementary suppression.
- AI validator: other-athlete id, unauthorized source, invented quote, diagnosis language, extra fields, action stripping; prompt fencing.
- Billing: duplicate and out-of-order events, checkout alone not entitling, sponsor blocks double billing.
- Notifications: quiet hours, consent, SMS off, neutral titles, no false "delivered".
- Parent-brief leak and pressure checks.
- Demo backend end-to-end loop: idempotent submit and publish, concurrency rule, pending coach blind, pending minor blocked, guardian onboarding, coach invite to verification, revocation, stale review, AI outage and thin-context fallback, solo honesty, transactional rollback, cohort suppression.
- Edge Function logic: AI provider fallback and timeout, Stripe signature tolerance, live-key and live-event refusal, email dispatch retries.
- Config refuses secret keys and demo-in-production; the role switcher renders only for the demo adapter.

**DB integration** (`tests/db`): applies every migration to a fresh database and calls RPCs exactly as PostgREST would (`SET LOCAL ROLE authenticated` plus JWT claims).
- RLS on every table; anonymous users denied; no direct writes; service-only functions blocked.
- Hashes never selectable; profiles are not a directory.
- Pending minor cannot store diary, sessions or audio; consent ordering; under-13 blocked; unverified email blocked.
- Same-name athletes isolated; guessed IDs denied; pending, unrelated and suspended coaches denied; unlinked guardian denied; cross-team, cross-club and composite-FK isolation.
- Invite replay, expiry, revocation, mismatch, forgery and rate limit.
- Forged verification, missing MFA and self-verification refused.
- **Two genuinely concurrent transactions to different coaches produce exactly one active request.** A mutation test confirmed this check fails without the partial unique index.
- Idempotent request and publication; expiry never fabricates closure.
- Second adult sees the shared request and response but not the diary; drafts stay private; changed draft or audience invalidates review.
- Guardian revocation cancels exchanges and blocks reads; coach suspension removes access.
- Team transcripts are coach-only; focus proposals need athlete acceptance (one current version enforced).
- Briefs: published only, no quotes, revocable. Per-record share and revoke.
- Session cancel and reschedule with optimistic concurrency; DB length and mood checks.
- Consent withdrawal workflow; SMS and email consent rules; notification dedupe.
- Export contains only the subject's records; account deletion removes diary, audio metadata and derived outputs, and the audit trail keeps no content.
- Concern visibility needs the safeguarding role plus MFA; audit is append-only even for the owner role.
- Billing dedupe, ordering and no resurrection; sponsor entitlement; one live subscription per athlete.
- The synthetic seed applies through the real RPCs.

**End-to-end** (`e2e/`):
- The full 3-minute demo script through the UI, including double-clicking Publish (exactly one publication).
- Pending minor cannot reach the reflection form.
- Adult solo flow (a double-tap submit creates exactly one reflection; no "Loop closed").
- Draft survives reload; keyboard-only submit; local draft cleared after submit.
- Pending coach sees no content.
- **axe (WCAG 2.1 A/AA) with zero violations, and no horizontal overflow at 320px and 390px**, on 10 screens.

Screenshots of the rendered mobile screens are in `docs/screenshots/` and were inspected by eye, not only through DOM assertions.

## What these results do NOT prove (unavailable services, reported plainly)

- **No real Supabase stack was available.** Docker's daemon and the Supabase CLI were not available. DB tests ran on vanilla PostgreSQL 16 with `tests/db/supabase-shim.sql`, which emulates `auth.uid()`/`auth.jwt()`, roles and a minimal `storage` schema. The real Supabase Auth (email confirmation, MFA/aal2 issuance), PostgREST, Storage API (signed URLs, object deletion) and Supabase default grants were **not** exercised. `SupabaseApi` is type-checked but has **not** run against a live project.
- **Edge Functions were not executed in Deno.** Deno is not installed. Their shared logic is unit-tested under Node; the `index.ts` wiring is untested.
- No real email, SMS, Stripe or Anthropic call was made (by design).
- Backup and restore were not tested (no hosted database). See the readiness checklist.
- Screen-reader behaviour was checked structurally (labels, roles, live regions, focus on navigation, axe), not with a human using VoiceOver or TalkBack.
- Browsers: Chromium only. Safari/WebKit and Firefox not run.
