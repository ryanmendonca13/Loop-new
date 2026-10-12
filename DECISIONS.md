# Decisions

This build uses conservative defaults so the synthetic version could be built without waiting on policy. **Each item in section A is a proposed pilot choice. The owner must confirm it before any production gate opens.** Section B records engineering decisions.

## A. Proposed pilot choices (owner confirmation required)

| # | Area | Proposed default in this build | Where |
|---|---|---|---|
| A1 | Minor threshold | Under-18 athletes need a verified guardian link, guardian consent and athlete assent before **any** diary, audio or sensitive profile content is stored. This is a conservative pilot policy, not a claim about any jurisdiction's legal threshold. | `policy.ts activationGaps`, `app.activation_gaps` |
| A2 | Under-13 | Blocked from activation (`under_13_review` gap) until guardian-led flow and legal review are done. | same |
| A3 | Age data | Store only an age band (`under_13`, `13_17`, `18_plus`). No birth date. | `profiles.eligibility_band` |
| A4 | Guardian verification | A human pilot reviewer (MFA) verifies each guardian link and records an evidence reference. Links are never inferred from surnames or email. | `review_guardian_link` |
| A5 | Coach verification | A human reviewer verifies identity plus the athlete's (and, for minors, the guardian's) approval, with an evidence reference. **Not a background check.** | `review_coach_relationship` |
| A6 | Rule of Two | Every minor coach exchange needs a second adult. The default and only allowed second adult is an active verified linked guardian. Other adults need a separate approved policy (not built). | `gate_failures`, `set_second_adult` |
| A7 | Historical access after revocation | Revoking a guardian or coach cancels open exchanges and blocks **new** reads immediately. Records are kept (not destroyed) pending the final retention policy. The UI says that already-viewed content cannot be recalled. | `revoke_*` RPCs |
| A8 | Invite expiry | 7 days, single use, 256-bit token, hash only stored, token in URL fragment. Configurable in `app_settings`. | `constants.ts`, `app_settings` |
| A9 | Response window | Next session time if it is in the future, else 48 hours. Expiry frees the slot but never marks the request complete. | `responseDueAt`, `create_loop_request` |
| A10 | One active request | Global per athlete, enforced by a partial unique index. | `loop_requests_one_active` |
| A11 | AI | Claude API through a server adapter, mock by default. Inputs are limited to the shared excerpt, the question and the current NOW. **Action recommendations off.** Coach must approve all outputs. | `_shared/ai.ts`, `AI_ACTION_RECOMMENDATIONS=false` |
| A12 | Voice | Optional, with separate consent. Demo transcript is simulated and labelled. Production transcription is off until processor, privacy and retention review. | `simulateVoiceTranscript` |
| A13 | Notifications | In-app always. Email only with consent and preference, neutral content and secure link, quiet hours 21:00–08:00 local. SMS disabled. | `notifications.ts`, `notify-dispatch` |
| A14 | Director aggregates | P1, off. Minimum cohort 5 with complementary suppression. Individual access would need a separate audited grant (not built). | `aggregates.ts` |
| A15 | Retention, deletion, export | Export covers the subject's own records. Deletion covers diary, audio and derived outputs, executed by an operator after review. Retention periods and lawful exceptions are **TBD**. | `export_my_data`, `process_deletion` |
| A16 | Billing | Off. Test keys only. Adult payer. Sponsor coverage blocks checkout. No prices configured. ($5/$9/$12 are interview hypotheses only.) | `billing.ts`, functions |
| A17 | Safeguarding | A named safeguarding owner (configured in `app_settings`) receives concern reports. People decide severity. No automated escalation or monitoring claims. | `report_concern` |
| A18 | Privacy and consent texts | Placeholder pilot wording, version `pilot-2026-10`. Needs legal drafting. | UI, `policy_version` |

## Unresolved (outside this build)

- Code and IP rights, and the handoff from the old platform.
- Any legacy data migration. None is built; it needs legal rights, consent, mappings and reconciliation sign-off.
- Pricing, currency, tax treatment and terms.
- Jurisdiction-specific legal review (for example PIPEDA, provincial law and CASL in Canada; COPPA, GDPR or UK-GDPR if applicable).

## B. Engineering decisions

1. **Fresh scaffold.** The repository was empty, so there was no framework to preserve.
2. **Writes only through RPCs.** Clients get SELECT under RLS. Every mutation is a `SECURITY DEFINER` function with `search_path=''` and explicit `auth.uid()` checks. Default `PUBLIC` EXECUTE is revoked and grants are explicit.
3. **Separate tables for separate audiences.** The private diary (`reflections`), shared snapshots (`loop_requests.shared_excerpt`), coach-only content (`feedback_drafts`, `coach_notes`), published content (`feedback_publications`) and guardian cues (`parent_briefs`) are distinct tables. An over-broad SELECT on one cannot leak another.
4. **Audience hash.** The audience is shown before submit and before publish. Its hash must match at commit time, so a changed audience invalidates an earlier review.
5. **Idempotency keys.** Reflection submit, request creation and publication are retry-safe and double-tap safe.
6. **Immutable publications.** Corrections create a new version and supersede the old one. A trigger blocks silent overwrites.
7. **Append-only audit.** Metadata only. Keys suggesting content or secrets are rejected in both TypeScript and SQL.
8. **Demo adapter.** Mirrors the SQL rules using the shared domain policies, so the demo behaves honestly. It is not a security boundary. Demo and Supabase adapters are loaded lazily and never mixed. Demo is refused when `VITE_DEPLOY_ENV=production`.
9. **Staff powers need `aal2`** (MFA) in SQL, not just in the UI.
10. **DB tests run on PostgreSQL 16 with a shim**, because Docker and the Supabase CLI were unavailable here. See `docs/TEST_RESULTS.md` for what this does and does not prove.
