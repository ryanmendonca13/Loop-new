# 3-minute demo script (synthetic)

Run `npm run dev` (or `npm run build:demo && npm run preview`) and open it at phone width (390px). Everything shown is fictional. Nothing is sent.

| Time | Persona (View as) | Do | Point out |
|---|---|---|---|
| 0:00 | Signed out | Welcome page | The promise. No team needed. The Demo banner stays on screen. |
| 0:15 | **Max O.** (athlete, 13–17) | Home, then **Reflect now** | The two exact prompts. "Draft saved" autosave. Mood is optional and stays blank, not zero. |
| 0:45 | Max | **Save reflection** | "Saved once". Private by default. |
| 0:55 | Max | **Coaches**: invite "Coach Riley N." at riley@coach.example.test | The simulated, copyable link contains no diary data. Expiry is shown. Coach Kim shows *Verification pending* and cannot receive anything. |
| 1:15 | Max | **History**, then **Ask a coach about this** | Edit the excerpt. **Who will see this** lists Max, Coach Sam and Pat as second adult (guardian). Tick confirm and send. |
| 1:35 | **Pat O.** (guardian) | Family | Pat sees the exact shared request (Rule of Two) but not Max's other answers. Existing support cues are visible. |
| 1:50 | **Coach Sam R.** | Coach, then the request | **Organize with AI (draft only)**, labelled *Generated suggestion — not a coach*. Write one action, one situation and one measure. **Preview**, confirm recipient, content and audience, then **Publish**. |
| 2:20 | Sam | Add a support cue for Pat, then Coach inbox: Mark reviewed, Publish to guardian | Quotes and ranking language are refused. |
| 2:35 | **Max O.** | Home shows *Coach responded*. Open it, then **Make this my NEXT** | Verified-coach attribution. NEXT changes only because Max accepted it. *Loop closed*. |
| 2:50 | **Pat O.** | Family | The new support cue and approved focus. Still no raw diary. |

Optional extras: **Ava R.** shows the pending-guardian shell (no reflection form). **Ava T.** shows adult solo mode, which says "Personal reflection" and never "Loop complete". **Jordan B.** shows the verification queue (evidence reference required), concern triage and the metadata-only audit log.

The same flow runs automatically in `e2e/demo-loop.spec.ts`.
