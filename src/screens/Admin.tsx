import { useState } from 'react';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { Button, Card, EmptyState, Loading, Notice, PageHeader, Pill, TextInput } from '../ui/components';
import { formatWhen } from '../ui/format';

export function Admin() {
  const { api } = useApp();
  const { data, error } = useLoad(() => api.getAdmin());
  const act = useAction();
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Pilot admin" subtitle="Restricted. Every action is audited. You see operational metadata, not reflections." />
      {api.kind === 'demo' ? <Notice tone="warn">Demo: multi-factor authentication is simulated for this persona. Production requires a real second factor.</Notice> : null}
      {data.canReview ? (
        <Card>
          <h2 className="font-bold">Verification queue</h2>
          <p className="text-sm text-ink-soft">Human review of identity and the athlete/guardian-approved relationship. Record an evidence reference. This is not a background check.</p>
          {data.queue.length === 0 ? (
            <EmptyState title="Queue is empty" />
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {data.queue.map((q) => (
                <li key={q.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      {q.kind === 'coach' ? 'Coach' : 'Guardian'}: {q.subjectName} → athlete <span className="font-mono">{q.athleteRef}</span>
                    </span>
                    <Pill tone="warn">{q.state.replaceAll('_', ' ')}</Pill>
                  </div>
                  {q.guardianApproved === false ? <p className="text-sm text-warn">Guardian approval still needed before this coach can be verified.</p> : null}
                  <TextInput label="Evidence reference" hint="e.g. call log or document check ID (no documents stored here)" value={evidence[q.id] ?? ''} onChange={(v) => setEvidence({ ...evidence, [q.id]: v })} required max={120} />
                  <div className="flex flex-wrap gap-2">
                    {q.kind === 'coach' ? (
                      <>
                        <Button busy={act.busy} disabled={!evidence[q.id]?.trim()} onClick={() => act.run(() => api.reviewCoach(q.id, q.state === 'suspended' ? 'reinstate' : 'verify', evidence[q.id]!))}>
                          {q.state === 'suspended' ? 'Reinstate' : 'Verify'}
                        </Button>
                        <Button variant="danger" busy={act.busy} disabled={!evidence[q.id]?.trim()} onClick={() => act.run(() => api.reviewCoach(q.id, 'reject', evidence[q.id]!))}>
                          Reject
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button busy={act.busy} disabled={!evidence[q.id]?.trim()} onClick={() => act.run(() => api.reviewGuardianLink(q.id, 'verify', evidence[q.id]!))}>
                          Verify link
                        </Button>
                        <Button variant="danger" busy={act.busy} disabled={!evidence[q.id]?.trim()} onClick={() => act.run(() => api.reviewGuardianLink(q.id, 'reject', evidence[q.id]!))}>
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {data.canSafeguard ? (
        <Card>
          <h2 className="font-bold">Concern reports</h2>
          <p className="text-sm text-ink-soft">A person decides severity and next steps using the reviewed escalation procedure. Loop makes no automatic decisions.</p>
          {data.concerns.length === 0 ? (
            <EmptyState title="No reports" />
          ) : (
            <ul className="mt-2 space-y-3">
              {data.concerns.map((c) => (
                <li key={c.id} className="rounded-lg border border-line p-3 text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Pill tone="warn">{c.state}</Pill> <Pill>{c.severity}</Pill> {formatWhen(c.createdAt)}
                  </p>
                  <p className="mt-1">{c.description}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['low', 'medium', 'high'] as const).map((s) => (
                      <Button key={s} variant="secondary" onClick={() => act.run(() => api.triageConcern(c.id, 'triaged', s))}>
                        Triage: {s}
                      </Button>
                    ))}
                    <Button variant="ghost" onClick={() => act.run(() => api.triageConcern(c.id, 'closed', c.severity))}>
                      Close
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      <Card>
        <h2 className="font-bold">Audit log (metadata only)</h2>
        <ul className="mt-2 max-h-96 space-y-1 overflow-y-auto text-xs">
          {data.audit.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1">
              <span className="font-mono">{e.action}</span>
              <span>{e.purpose}</span>
              <span className="text-ink-soft">{formatWhen(e.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
