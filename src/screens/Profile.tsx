import { useState } from 'react';
import { Link } from 'react-router';
import { FOCUS_CATEGORY_LABELS } from '../domain';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { Button, Card, DefinitionRow, EmptyState, Loading, Notice, PageHeader, Pill, SourceLabel } from '../ui/components';
import { formatWhen } from '../ui/format';

export function Profile() {
  const { api } = useApp();
  const { data, error } = useLoad(() => Promise.all([api.getTimeline(), api.getAthleteHome(), api.getSettings()]));
  const act = useAction();
  const [shareFor, setShareFor] = useState<string | null>(null);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const [items, home, settings] = data;
  const verified = home.coaches.filter((c) => c.verificationState === 'verified');
  const activeShares = settings.shares.filter((s) => !s.revokedAt);
  return (
    <div className="space-y-4">
      <PageHeader title="Your history" subtitle="Your record follows you, not a team. New coaches or teams never see it automatically." />
      <Card>
        <h2 className="font-bold">Current focus</h2>
        {home.currentFocus ? (
          <dl className="mt-1">
            <DefinitionRow term="Next">{home.currentFocus.nextAction} — {home.currentFocus.nextSituation}</DefinitionRow>
            {home.currentFocus.northStar ? <DefinitionRow term="North star">{home.currentFocus.northStar}</DefinitionRow> : null}
            {home.currentFocus.categories.length ? <DefinitionRow term="Tags">{home.currentFocus.categories.map((c) => FOCUS_CATEGORY_LABELS[c]).join(', ')}</DefinitionRow> : null}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">No focus chosen yet.</p>
        )}
      </Card>
      {activeShares.length ? (
        <Card>
          <h2 className="font-bold">Records you’ve shared</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {activeShares.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  A {s.recordType} with {s.recipientName} ({s.surface.replace('_', ' ')})
                </span>
                <Button variant="ghost" onClick={() => act.run(() => api.revokeShare(s.id))}>
                  Stop sharing
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">Stopping blocks new views immediately. Anything already viewed or downloaded cannot be recalled.</p>
        </Card>
      ) : null}
      <section aria-labelledby="tl-h" className="space-y-2">
        <h2 id="tl-h" className="text-lg font-bold">Timeline</h2>
        {items.length === 0 ? (
          <EmptyState title="Nothing here yet" action={<Link to="/reflect" className="font-semibold text-brand underline">Write your first reflection</Link>} />
        ) : (
          <ol className="space-y-2">
            {items.map((it) => (
              <li key={`${it.kind}-${'reflection' in it ? it.reflection.id : 'publication' in it ? it.publication.id : 'focus' in it ? it.focus.id : it.request.id}`}>
                <Card as="article">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                    <span className="font-semibold uppercase tracking-wide">{{ reflection: 'Reflection', feedback: 'Coach feedback', focus: 'Focus chosen', request: 'Coach request' }[it.kind]}</span>
                    <time dateTime={it.at}>{formatWhen(it.at)}</time>
                  </div>
                  {it.kind === 'reflection' ? (
                    <div className="mt-1 space-y-1">
                      <p>
                        <span className="text-ink-soft">Well:</span> {it.reflection.answerWell}
                      </p>
                      <p>
                        <span className="text-ink-soft">Moment back:</span> {it.reflection.answerMomentBack}
                      </p>
                      <SourceLabel source="athlete_words" />
                      {verified.length ? (
                        <Link to={`/request/new?reflection=${it.reflection.id}`} className="ml-2 text-sm font-semibold text-brand underline">
                          Ask a coach about this
                        </Link>
                      ) : null}
                      {verified.length ? (
                        shareFor === it.reflection.id ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {verified.map((c) => (
                              <Button key={c.relationshipId} variant="secondary" onClick={async () => { await act.run(() => api.grantShare({ recordType: 'reflection', recordId: it.reflection.id, recipientUserId: c.coachUserId, surface: 'coach_history', purpose: 'context for my coach' })); setShareFor(null); }}>
                                Share with {c.coachName}
                              </Button>
                            ))}
                            <Button variant="ghost" onClick={() => setShareFor(null)}>Cancel</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" onClick={() => setShareFor(it.reflection.id)}>
                            Share this entry…
                          </Button>
                        )
                      ) : null}
                    </div>
                  ) : null}
                  {it.kind === 'feedback' ? (
                    <div className="mt-1">
                      <p>
                        <strong>{it.publication.oneNextAction}</strong> — {it.publication.situation}
                      </p>
                      <p className="text-sm">{it.coachName}</p>
                      <SourceLabel source="coach_observation" />
                    </div>
                  ) : null}
                  {it.kind === 'focus' ? (
                    <div className="mt-1">
                      <p>NEXT: {it.focus.nextAction}</p>
                      <p className="text-sm text-ink-soft">{it.focus.changeReason}{it.focus.supersededAt ? ' · replaced later' : ' · current'}</p>
                      <SourceLabel source={it.source} />
                    </div>
                  ) : null}
                  {it.kind === 'request' ? (
                    <div className="mt-1">
                      <p>
                        Asked {it.coachName}: {it.request.question}
                      </p>
                      <Pill>{it.label}</Pill>{' '}
                      <Link to={`/feedback/${it.request.id}`} className="text-sm text-brand underline">
                        Open
                      </Link>
                    </div>
                  ) : null}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </section>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
