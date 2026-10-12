import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { AudienceList, Button, Card, DefinitionRow, EmptyState, Loading, Notice, PageHeader, Pill, SourceLabel } from '../ui/components';
import { VERIFICATION_TEXT } from './Coaches';
import { formatWhen } from '../ui/format';

export function GuardianHome() {
  const { api } = useApp();
  const { data, error } = useLoad(() => api.getGuardianHome());
  const act = useAction();
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Family" subtitle="Support cues and the coach exchanges your athlete shares. Their private diary stays private." />
      {data.children.length === 0 ? <EmptyState title="No linked athletes">Ask your athlete to send you an invite from Loop.</EmptyState> : null}
      {data.children.map((c) => (
        <section key={c.linkId} aria-labelledby={`child-${c.linkId}`} className="space-y-3">
          <h2 id={`child-${c.linkId}`} className="text-xl font-bold">
            {c.displayName}
          </h2>
          {c.linkStatus !== 'active' ? (
            <Notice tone="warn" title="Waiting for verification">
              A person on the pilot team verifies each guardian link. Nothing about {c.displayName} is shown until then.
            </Notice>
          ) : (
            <>
              {!c.guardianConsentGiven ? (
                <Card className="space-y-2">
                  <h3 className="font-bold">Consent for {c.displayName}</h3>
                  <p className="text-sm">
                    Loop will store {c.displayName}’s reflections privately for them. You will see coach exchanges they share (Rule of Two) and support cues a verified coach writes for you. You can
                    withdraw at any time, which pauses their account. (Pilot consent text — pending owner/legal approval.)
                  </p>
                  <Button busy={act.busy} onClick={() => act.run(() => api.recordConsent('guardian_consent', c.athleteId))}>
                    I consent as {c.displayName}’s guardian
                  </Button>
                </Card>
              ) : (
                <p className="text-sm">
                  Account: <Pill tone={c.accountState === 'active' ? 'ok' : 'warn'}>{c.accountState.replace('_', ' ')}</Pill>
                </p>
              )}
              {c.coachesAwaitingApproval.length ? (
                <Card>
                  <h3 className="font-bold">Coach waiting for your approval</h3>
                  <ul className="mt-2 space-y-2">
                    {c.coachesAwaitingApproval.map((k) => (
                      <li key={k.relationshipId} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{k.coachName}</span>
                        <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => api.approveCoach(k.relationshipId))}>
                          Approve and be the second adult
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-ink-soft">Approval lets the pilot team finish verifying this coach. You will see every exchange between them and {c.displayName}.</p>
                </Card>
              ) : null}
              <Card>
                <h3 className="font-bold">Support cues</h3>
                {c.briefs.length ? (
                  <ul className="mt-2 space-y-3">
                    {c.briefs.map((b) => (
                      <li key={b.id} className="rounded-lg bg-brand-soft p-3">
                        <dl>
                          <DefinitionRow term="Something to say">{b.somethingToSay}</DefinitionRow>
                          <DefinitionRow term="A question to ask">{b.questionToAsk}</DefinitionRow>
                          <DefinitionRow term="A habit to praise">{b.habitToPraise}</DefinitionRow>
                        </dl>
                        <p className="mt-1 text-xs text-ink-soft">Reviewed by their coach · {formatWhen(b.publishedAt)}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-ink-soft">No support cues yet. Their coach writes these after reviewing them.</p>
                )}
              </Card>
              <Card>
                <h3 className="font-bold">Current focus (approved by {c.displayName})</h3>
                {c.focus ? (
                  <dl className="mt-1">
                    <DefinitionRow term="Next">{c.focus.nextAction} — {c.focus.nextSituation}</DefinitionRow>
                    {c.focus.northStar ? <DefinitionRow term="North star">{c.focus.northStar}</DefinitionRow> : null}
                  </dl>
                ) : (
                  <p className="mt-1 text-sm text-ink-soft">No focus chosen yet.</p>
                )}
              </Card>
              <Card>
                <h3 className="font-bold">Coach exchanges you can see</h3>
                <p className="text-xs text-ink-soft">You are the second adult on these. You see exactly what was shared and what the coach published — nothing else.</p>
                {c.sharedThreads.length ? (
                  <ul className="mt-2 space-y-3">
                    {c.sharedThreads.map((t) => (
                      <li key={t.request.id} className="rounded-lg border border-line p-3">
                        <p className="text-sm">
                          <Pill>{t.label}</Pill> with {t.coachName} · {formatWhen(t.request.createdAt)}
                        </p>
                        <dl className="mt-1">
                          <DefinitionRow term="Shared by athlete">
                            {t.request.sharedExcerpt} <SourceLabel source="athlete_words" />
                          </DefinitionRow>
                          <DefinitionRow term="Question">{t.request.question}</DefinitionRow>
                          {t.publication ? (
                            <DefinitionRow term="Coach response">
                              <strong>{t.publication.oneNextAction}</strong> — {t.publication.situation}. Measure: {t.publication.measure}
                            </DefinitionRow>
                          ) : null}
                        </dl>
                        <details className="mt-2 text-sm">
                          <summary className="cursor-pointer text-brand">Who can see this</summary>
                          <AudienceList members={t.request.audience.members} />
                        </details>
                        <Button variant="ghost" onClick={() => act.run(() => api.reportConcern({ description: 'Guardian flagged a coach exchange for review.', subjectAthleteId: c.athleteId, referenceType: 'loop_request', referenceId: t.request.id }))}>
                          Report a concern
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-ink-soft">No shared exchanges yet.</p>
                )}
              </Card>
              {c.coaches.length ? (
                <Card>
                  <h3 className="font-bold">Coaches</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {c.coaches.map((k) => (
                      <li key={k.relationshipId} className="flex flex-wrap items-center justify-between gap-2">
                        <span>{k.coachName}</span>
                        <Pill tone={VERIFICATION_TEXT[k.verificationState].tone}>{VERIFICATION_TEXT[k.verificationState].label}</Pill>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </>
          )}
          <Button
            variant="danger"
            onClick={() =>
              window.confirm(`Remove your link to ${c.displayName}? Coach exchanges that rely on you will stop, and their account pauses until another guardian is linked.`) &&
              act.run(() => api.revokeGuardianLink(c.linkId))
            }
          >
            Remove my guardian link
          </Button>
        </section>
      ))}
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
