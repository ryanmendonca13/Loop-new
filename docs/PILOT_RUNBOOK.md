# Pilot runbook (draft, for a supervised pilot after the readiness gates)

## Roles
- **Product owner**: approves decisions, pilot cohort and communications.
- **Safeguarding owner**: receives concern reports and follows the approved escalation procedure. Is not a 24/7 monitor.
- **Verification reviewer(s)**: verify guardian links and coach relationships, and record an evidence reference for each. MFA required.
- **Operator**: runs approved deletions (`data-rights` function) and scheduled jobs. Watches error dashboards.

## Daily
1. Check the verification queue (Admin). Target: decide within 2 business days. Never verify your own relationships.
2. Check concern reports (safeguarding owner).
3. Check `notify-dispatch` failures (`notification_jobs.state = 'failed'`) and function errors.

## Onboarding a minor (pilot policy A1)
1. The athlete creates a pending shell and invites a guardian by email (copy link or approved email).
2. The guardian logs in with that email and accepts.
3. The reviewer verifies the linkage through the approved process (for example a call). Record an evidence ref such as `call-2026-11-03-01`. **Never infer from surnames.**
4. The guardian records consent; the athlete records assent. The account activates automatically.

## Verifying a coach
1. The athlete invites a named coach. The coach accepts using the invited email (state: identity pending).
2. For minors, the guardian approves the coach and becomes the second adult.
3. The reviewer checks identity per the procedure and records the evidence ref. This is not a background check; do not describe it as one.

## Incidents
- **Suspected misuse by a coach**: Admin, then *Suspend* (access ends immediately and open requests are cancelled). Then follow the safeguarding procedure.
- **Guardian withdraws**: handled automatically (account `withdrawal_pending`, exchanges cancelled). Follow the withdrawal workflow for retained records.
- **Deletion request**: confirm identity, check retention exceptions, then call `data-rights` with the request id. Record completion.
- **Data exposure suspicion**: revoke the affected relationship or grant, preserve audit events and start the incident response and breach assessment.

## Never
- Don't promise confidentiality or continuous monitoring.
- Don't send diary or coach content in email or SMS.
- Don't enable SMS, billing, live AI or production transcription without the readiness gates.
- Don't import legacy youth data.
