# Production readiness checklist

**Current verdict: NOT READY.** This is a tested synthetic pilot build. Passing builds and tests do not make it production-ready. Every gate below must be checked off, with evidence, by a named owner. Gates marked 🔒 are closed in code until someone deliberately changes configuration.

Legend: ✅ done and evidenced in this build · 🟡 partially done, verify · ⬜ not done · 🔒 closed in code

## 1. Owner and legal decisions
- ⬜ Confirm or replace every proposed default in `DECISIONS.md` (A1–A18).
- ⬜ Legal review of privacy notice, guardian consent, athlete assent and terms (texts are placeholders, version `pilot-2026-10`).
- ⬜ Jurisdictions and age thresholds confirmed. Under-13 flow designed and reviewed (🔒 blocked in code).
- ⬜ Retention periods, lawful exceptions and the withdrawal workflow documented and approved.
- ⬜ Code/IP rights and old-platform handoff resolved. No legacy data import (none built).
- ⬜ CASL / anti-spam review of every message category before any email or SMS.

## 2. Safeguarding
- ⬜ Named safeguarding owner appointed and configured (`app_settings.safeguarding_owner_user_id`).
- ⬜ Reviewed escalation procedure, response-time expectations and out-of-hours wording.
- ✅ Concern reports restricted to reporter and safeguarding owner (with MFA). Severity is chosen by a human. Audited.
- ✅ Rule of Two enforced in the database for minors. Second adult defaults to a verified linked guardian.
- ⬜ Policy for any second adult other than a guardian (not built; would need approval).
- ⬜ Coach verification procedure documented (what evidence counts). UI and texts state it is **not** a background check.

## 3. Identity and access
- ✅ Deny-by-default RLS on every table. Writes only through checked RPCs. DB tests pass on PostgreSQL 16 with a shim.
- ⬜ Re-run the DB test suite against a real Supabase **staging** project (see `docs/KNOWN_GAPS.md` #1).
- ⬜ Confirm Supabase default grants and that the RPC owner bypasses RLS as expected.
- 🟡 Staff RPCs require `aal2`. MFA enrolment flow for staff still needs testing in real Supabase Auth.
- ⬜ Email confirmation required in Auth settings (`enable_confirmations = true` in `supabase/config.toml` for local).
- ✅ Browser holds the publishable key only. The build refuses `VITE_*` secrets; the app refuses service-role and secret keys.
- ⬜ Storage: test signed-URL issuance (60s TTL) after authorization. Confirm object deletion end to end.

## 4. Data protection and operations
- ✅ Export of the subject's own records. Deletion RPC removes diary, audio metadata and derived outputs, and the audit trail keeps no content (tested).
- ⬜ `data-rights` function exercised in Deno against staging, including storage object and auth user deletion.
- ⬜ **Backups and restore test** on the hosted project (PITR enabled, a restore rehearsed and documented). Not possible here.
- ⬜ Scheduled jobs: `expire-requests`, `notify-dispatch`, and retention purges (not built).
- ⬜ Log redaction verified on hosted logs. Operational logs kept separate from athlete records.
- ⬜ Monitoring, alerting and incident response runbook. Breach notification procedure.
- ⬜ Separate staging and production projects, keys and secrets. Production secrets accessible to named people only.

## 5. Integrations
- 🔒 AI: mock until `AI_PROVIDER=anthropic` is set. Action recommendations off until the owner decides. Processor agreement, data-handling terms, budget and timeouts to be approved.
- 🔒 Voice transcription off in Supabase mode. Processor, privacy and retention review required.
- 🔒 Email: mock provider only. Provider, sender domain (SPF/DKIM/DMARC), templates and unsubscribe to be approved.
- 🔒 SMS: refused by server config. Needs verified number binding, recycled-number handling, separate opt-in, HELP/STOP, quiet hours, signed inbound webhooks, dedupe, opt-out tests and Rule-of-Two-safe content.
- 🔒 Billing: off; Stripe **test** keys only, enforced in code. Needs approved amount, currency, tax and terms, a live price ID, and a webhook replay test in Stripe test mode.

## 6. Security review
- ✅ `npm audit` clean. Dependencies pinned. Lockfile committed.
- ✅ CSP and security headers in `vercel.json`. No `dangerouslySetInnerHTML` (lint rule). React escapes all content.
- ✅ Rate limits on invites, redemption, concerns, export and AI (DB level).
- ⬜ Independent security review or penetration test of RPCs and Edge Functions.
- ⬜ Auth rate limits and CAPTCHA reviewed on hosted Auth.

## 7. Product quality
- ✅ e2e demo flow, axe (WCAG 2.1 AA) with zero violations, and no 320/390px overflow on 10 screens (Chromium).
- ⬜ Manual screen-reader passes (VoiceOver iOS, TalkBack Android). Safari and Firefox runs.
- ⬜ Usability test of the ~90-second reflection with real (adult) pilot participants under an approved protocol.
- ⬜ Pilot runbook rehearsed (`docs/PILOT_RUNBOOK.md`).

## 8. Go / no-go
- ⬜ All ⬜ items above resolved or explicitly accepted in writing by the owner.
- ⬜ `VITE_APP_MODE=supabase`, `VITE_DEPLOY_ENV=production` build verified on staging first.
- ⬜ Sign-off: product owner · safeguarding owner · privacy/legal · engineering.
