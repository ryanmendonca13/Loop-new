# Architecture, data and permissions

## Components

```mermaid
flowchart LR
  subgraph Browser [Browser (publishable key only)]
    UI[React screens] --> API{{LoopApi}}
    API -->|demo build| DEMO[DemoBackend\nsynthetic, in-browser\nrole switcher]
    API -->|supabase build| SBA[SupabaseApi]
  end
  SBA -->|JWT| PGREST[(Postgres\nRLS SELECT)]
  SBA -->|JWT| RPC[[SECURITY DEFINER RPCs\nexplicit auth.uid checks]]
  SBA -->|JWT| EF1[ai-draft fn]
  EF1 -->|coach JWT| RPC
  EF1 -->|server key| LLM[(Claude API\nmock by default)]
  STRIPE[(Stripe test)] -->|signed webhook| EF2[stripe-webhook fn\nservice role, billing_* only]
  CRON[[scheduler]] --> EF3[notify-dispatch / expire-requests]
  OPS[[operator after review]] --> EF4[data-rights fn]
  EF2 & EF3 & EF4 --> RPC
  RPC --> PGREST
  STORE[(Private bucket: voice/<uid>/...)] --- PGREST
```

## Who can read what (enforced by RLS and RPC checks)

| Record | Athlete (owner) | Verified coach (this relationship) | Pending, rejected or suspended coach | Linked guardian (active, verified) | Other guardian | Staff (role + MFA) |
|---|---|---|---|---|---|---|
| Private reflection (diary) | ✅ | Only with a per-record `coach_history` grant | ❌ | ❌ | ❌ | ❌ |
| Shared request snapshot (excerpt + question) | ✅ | ✅ | ❌ | ✅ if named second adult **and** still linked | ❌ | ❌ |
| Feedback draft / coach notes / team transcript | ❌ | Author only | ❌ | ❌ | ❌ | ❌ |
| Published feedback | ✅ | Author, while verified | ❌ | ✅ if in the published audience and still linked | ❌ | ❌ |
| Current accepted focus | ✅ (all versions) | Current one, plus their own proposals | ❌ | Current one | ❌ | ❌ |
| Parent brief (support cue) | Published ones about them | Author, while verified | ❌ | Published, for their own active link | ❌ | ❌ |
| Voice audio (storage) | Own folder only | ❌ | ❌ | ❌ | ❌ | ❌ (deletion via operator function) |
| Concerns | Own reports | Own reports | Own reports | Own reports | Own reports | Safeguarding owner only |
| Audit events | About own athlete record, or own actions | Own actions | Own actions | Own actions | Own actions | Safeguarding owner and support admin (metadata only) |
| Invite token / email hashes | Never selectable (column grants) | — | — | — | — | — |

Cross-tenant access: club and team records carry a `tenant_id`. A composite foreign key `(team_id, tenant_id)` prevents mixing tenants. Visibility requires an active membership in that team or tenant. **An athlete's personal records have no tenant**, so joining a new team grants that team nothing from the athlete's history.

## State machines

`src/domain/stateMachines.ts` covers account, coach verification, activity session, assignment, loop request, feedback draft, parent brief, guardian link, notification and concern states. The SQL RPCs enforce the same transitions. The active request states (`queued`, `waiting_for_coach`, `response_draft`) match the partial unique index, and a unit test checks this.

## Rule of Two sequence (minor)

1. The athlete opens Share. `preview_exchange_audience` returns {athlete, coach, second_adult guardian} plus any gate failures.
2. The athlete confirms. `create_loop_request` re-runs the gates, compares the audience hash, inserts (subject to the unique index), notifies the coach and writes an audit event.
3. The coach drafts privately, then marks the draft reviewed (version and audience hash recorded).
4. `publish_feedback` runs in one transaction: it locks the request, re-runs the gates, checks the reviewed version and audience, inserts the publication (idempotent key), notifies the athlete and the second adult, and writes an audit event.
5. If the guardian link is revoked, open exchanges are cancelled, new reads stop immediately and the minor's account moves to `withdrawal_pending`.
