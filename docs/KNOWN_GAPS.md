# Known gaps

Engineering gaps in this build, apart from owner and policy decisions (see `DECISIONS.md`).

1. **Live Supabase verification.** Run `supabase db push` on a staging project, then repeat `tests/db` against it, or port the tests to `supabase test db` / pgTAP. Confirm `postgres` has BYPASSRLS, check default grants and Storage policies, and confirm MFA `aal` claims.
2. **Edge Functions in Deno.** `deno check` and integration runs (`supabase functions serve`) are still to do. `sloppy-imports` is used to share `src/domain`; consider a build step instead.
3. **Signed voice upload/playback.** The schema, storage policies and `register_voice_asset` exist. The browser recording and upload UI is a simulated transcript, and no signed-URL issuing function exists yet.
4. **Email delivery.** Only the mock provider exists. Approved provider and templates are pending, and queuing of guardian/coach invite emails is not implemented (copy-link only).
5. **AI per-coach daily budget** relies on rate limits plus provider limits. There is no explicit server counter check against `AI_DAILY_BUDGET_CALLS` yet.
6. **Team tools / director view (P1)** have only the coverage aggregate behind a disabled flag. Roster, mid-week focus, batch publish and director aggregates are not built.
7. **Guardian child view in Supabase mode** does not compute activation gaps client-side (shows none). The demo does.
8. **Login-time onboarding (Supabase).** An adult with a session but no profile can register through invite pages. A general "complete your profile" route is not built.
9. **Retention jobs.** No scheduled purge exists for withdrawn accounts, `delete_pending` voice, rate-limit rows or old notifications.
10. **CSP** is in `vercel.json` only. Other hosts need equivalent headers.
11. **Internationalisation.** English only; the `locale` column exists.
12. **Offline.** Drafts are kept locally for 24h, but there is no service worker or background sync.
13. **Supabase-mode `getAthleteHome` and similar screens** make several round trips. Add views or RPCs for performance before scale.
14. **WebKit and Firefox e2e runs** and manual screen-reader passes are still to do.
