import { Link } from 'react-router';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { Button, Card, EmptyState, Loading, Notice, PageHeader, Pill } from '../ui/components';
import { VERIFICATION_TEXT } from './Coaches';
import { relativeDue } from '../ui/format';

export function CoachInbox() {
  const { api } = useApp();
  const { data, error } = useLoad(() => api.getCoachInbox());
  const act = useAction();
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading />;
  const anyVerified = data.relationships.some((r) => r.verificationState === 'verified');
  return (
    <div className="space-y-4">
      <PageHeader title="Coach inbox" subtitle="One short request at a time. One concrete action back. Free for coaches." />
      {!anyVerified ? (
        <Notice tone="warn" title="Verification pending">
          You can’t see any athlete content until a person on the pilot team verifies you for that athlete. This is an identity and relationship check, not a background check.
        </Notice>
      ) : null}
      <Card>
        <h2 className="font-bold">Waiting for you</h2>
        {data.open.length === 0 ? (
          <EmptyState title="Nothing waiting">When an athlete asks you for feedback, it appears here.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.open.map((v) => (
              <li key={v.request.id} className="py-3">
                <Link to={`/coach/request/${v.request.id}`} className="block rounded-md">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-brand underline">
                      {v.athleteName} <span className="font-mono text-xs text-ink-soft">{v.athleteRef}</span>
                    </span>
                    <Pill tone={v.label === 'Coach drafting' ? 'brand' : 'warn'}>{v.label}</Pill>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm">{v.request.question}</p>
                  <p className="text-xs text-ink-soft">Due {relativeDue(v.request.dueAt)}{v.audience.members.some((m) => m.role === 'second_adult') ? ' · second adult can see this' : ''}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="font-bold">Athletes</h2>
        <ul className="mt-2 space-y-2">
          {data.relationships.map((r) => (
            <li key={r.relationshipId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {r.athleteName} <span className="font-mono text-xs text-ink-soft">{r.athleteRef}</span>
              </span>
              <Pill tone={VERIFICATION_TEXT[r.verificationState].tone}>{VERIFICATION_TEXT[r.verificationState].label}</Pill>
            </li>
          ))}
        </ul>
      </Card>
      {data.recent.length ? (
        <Card>
          <h2 className="font-bold">Recent</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {data.recent.map((v) => (
              <li key={v.request.id}>
                <Link to={`/coach/request/${v.request.id}`} className="text-brand underline">
                  {v.athleteName} {v.athleteRef}
                </Link>{' '}
                — {v.label}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {data.briefs.length ? (
        <Card>
          <h2 className="font-bold">Support cues for guardians</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {data.briefs.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.athleteName}: “{b.habitToPraise}” — <Pill>{b.state.replace('_', ' ')}</Pill>
                </span>
                <span className="flex gap-2">
                  {b.state === 'draft' ? <Button variant="secondary" onClick={() => act.run(() => api.advanceBrief(b.id, 'review'))}>Mark reviewed</Button> : null}
                  {b.state === 'coach_reviewed' ? <Button onClick={() => act.run(() => api.advanceBrief(b.id, 'publish'))}>Publish to guardian</Button> : null}
                  {b.state === 'published' ? <Button variant="ghost" onClick={() => act.run(() => api.advanceBrief(b.id, 'revoke'))}>Withdraw</Button> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
