import { useState } from 'react';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import type { CreatedInvite } from '../api/types';
import type { CoachVerificationState } from '../domain';
import { Button, Card, CopyField, EmptyState, Loading, Notice, PageHeader, Pill, TextInput } from '../ui/components';
import { formatWhen } from '../ui/format';

export const VERIFICATION_TEXT: Record<CoachVerificationState, { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral'; help: string }> = {
  invited: { label: 'Invited', tone: 'neutral', help: 'Has not accepted yet.' },
  identity_pending: { label: 'Verification pending', tone: 'warn', help: 'Accepted your invite. A person on the pilot team checks identity and your approval before they can see anything you share.' },
  verified: { label: 'Verified', tone: 'ok', help: 'A person checked identity and your approval. This is not a full background check.' },
  rejected: { label: 'Not verified', tone: 'danger', help: 'Cannot see anything you share.' },
  suspended: { label: 'Suspended', tone: 'danger', help: 'Access paused. Cannot see anything you share.' },
};

export function Coaches() {
  const { api } = useApp();
  const { data, error, loading } = useLoad(() => api.listCoaches());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const act = useAction();
  if (loading && !data) return <Loading />;
  if (error || !data) return <Notice tone="error">{error}</Notice>;
  return (
    <div className="space-y-4">
      <PageHeader title="Your coaches" subtitle="Invite the real coach you trust. Responding is free for coaches." />
      <Card>
        <h2 className="font-bold">Connected</h2>
        {data.coaches.length === 0 ? (
          <EmptyState title="No coaches yet">Your notebook works without one. Loop will never pretend to be your coach.</EmptyState>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {data.coaches.map((c) => {
              const v = VERIFICATION_TEXT[c.verificationState];
              return (
                <li key={c.relationshipId} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{c.coachName}</span>
                    <Pill tone={v.tone}>{v.label}</Pill>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{v.help}</p>
                  {c.secondAdultName ? <p className="mt-1 text-sm">Second adult on exchanges: {c.secondAdultName}</p> : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="danger" busy={act.busy} onClick={() => window.confirm(`Remove ${c.coachName}? They lose access to new shared content immediately. Anything they already saw cannot be recalled.`) && act.run(() => api.revokeCoach(c.relationshipId))}>
                      Remove coach
                    </Button>
                    <Button variant="ghost" busy={act.busy} onClick={() => window.confirm(`Block ${c.coachName}? This also removes them.`) && act.run(() => api.blockUser(c.coachUserId))}>
                      Block
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-bold">Invite a coach</h2>
        <form
          className="mt-2 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const c = await act.run(() => api.createCoachInvite({ coachDisplayName: name, coachEmail: email }));
            if (c) {
              setCreated(c);
              setName('');
              setEmail('');
            }
          }}
        >
          <TextInput label="Coach’s name" value={name} onChange={setName} required max={60} />
          <TextInput label="Coach’s email" type="email" inputMode="email" value={email} onChange={setEmail} required max={254} hint="The invite only works for this email. It contains no reflection or diary content." />
          <Button type="submit" busy={act.busy} disabled={!name.trim() || !email.trim()}>
            Create invite
          </Button>
        </form>
        {created ? (
          <div className="mt-3 space-y-2">
            <Notice tone="success" title="Invite created">
              {api.kind === 'demo' ? 'Demo: nothing was emailed. Copy this simulated link. ' : ''}It expires {formatWhen(created.expiresAt)} and can be used once. After they accept, a person verifies them before they can see anything.
            </Notice>
            <CopyField label="Invite link" value={created.link} />
          </div>
        ) : null}
        {data.invites.length ? (
          <ul className="mt-4 space-y-2 text-sm">
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {i.label} ({i.hint}) — {i.state}
                </span>
                {i.state === 'pending' ? (
                  <Button variant="ghost" onClick={() => act.run(() => api.revokeCoachInvite(i.id))}>
                    Withdraw
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
