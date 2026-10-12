import { useState } from 'react';
import { Navigate } from 'react-router';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import type { CreatedInvite } from '../api/types';
import { Button, Card, Checkbox, CopyField, Loading, Notice, PageHeader, Pill, TextInput } from '../ui/components';
import { GAP_TEXT, formatWhen } from '../ui/format';

export function Pending() {
  const { api, viewer } = useApp();
  const { data, error, loading } = useLoad(() => api.getPendingStatus());
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [assent, setAssent] = useState(false);
  const act = useAction();
  if (viewer?.accountState === 'active') return <Navigate to="/home" replace />;
  if (loading && !data) return <Loading />;
  if (error || !data) return <Notice tone="error">{error}</Notice>;
  const steps = ['privacy_notice', 'verified_guardian_link', 'guardian_consent', 'athlete_assent'] as const;
  const pendingInvite = data.invites.find((i) => i.state === 'pending');
  return (
    <div className="space-y-4">
      <PageHeader title="Almost ready" subtitle={`Hi ${data.displayName}. A parent or guardian activates your account before you start writing.`} />
      <Card>
        <h2 className="font-bold">Activation steps</h2>
        <ol className="mt-2 space-y-2">
          {steps.map((s) => {
            const done = !data.gaps.includes(s);
            return (
              <li key={s} className="flex items-start justify-between gap-3">
                <span>{GAP_TEXT[s]}</span>
                <Pill tone={done ? 'ok' : 'warn'}>{done ? 'Done' : 'Waiting'}</Pill>
              </li>
            );
          })}
          {data.gaps.includes('under_13_review') ? (
            <li className="flex items-start justify-between gap-3">
              <span>{GAP_TEXT.under_13_review}</span>
              <Pill tone="warn">Blocked in pilot</Pill>
            </li>
          ) : null}
        </ol>
        <p className="mt-3 text-sm text-ink-soft">Nothing you write is stored until these steps are complete.</p>
      </Card>

      <Card>
        <h2 className="font-bold">Invite your parent or guardian</h2>
        {data.linkStates.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {data.linkStates.map((l) => (
              <li key={l.id}>
                {l.guardianName ?? 'Guardian'}: <Pill>{l.status.replaceAll('_', ' ')}</Pill>
              </li>
            ))}
          </ul>
        ) : null}
        {data.invites.length ? (
          <ul className="mt-2 space-y-2">
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  Invite to {i.hint} — {i.state === 'pending' ? `expires ${formatWhen(i.expiresAt)}` : i.state}
                </span>
                {i.state === 'pending' ? (
                  <Button variant="ghost" onClick={() => act.run(() => api.cancelGuardianInvite(i.id))}>
                    Cancel invite
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const c = await act.run(() => api.createGuardianInvite(email));
            if (c) {
              setCreated(c);
              setEmail('');
            }
          }}
        >
          <TextInput label={pendingInvite ? 'Send a new invite to' : 'Guardian’s email'} type="email" inputMode="email" value={email} onChange={setEmail} required max={254} hint="We only use this to send the invite. The invite never contains anything you write." />
          <Button type="submit" busy={act.busy} disabled={!email}>
            {pendingInvite ? 'Resend invite' : 'Create invite'}
          </Button>
        </form>
        {created ? (
          <div className="mt-3 space-y-2">
            <Notice tone="success" title="Invite ready">
              {api.kind === 'demo' ? 'Demo: nothing was emailed. Copy this simulated link.' : 'Share this link with your guardian. It expires and works once.'}
            </Notice>
            <CopyField label="Invite link" value={created.link} />
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-bold">Your agreement</h2>
        {data.gaps.includes('athlete_assent') ? (
          <div className="mt-2 space-y-3">
            <Checkbox label="I want to use Loop to reflect and ask my coach for feedback" hint="Your guardian will be able to see coach exchanges you choose to share, and support cues your coach writes. Not your private diary." checked={assent} onChange={setAssent} />
            <Button disabled={!assent} busy={act.busy} onClick={() => act.run(() => api.recordConsent('athlete_assent'))}>
              Record my agreement
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm">Recorded. Thank you.</p>
        )}
      </Card>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
