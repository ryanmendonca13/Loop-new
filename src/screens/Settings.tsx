import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ConsentPurpose } from '../domain';
import { deliveryLabel } from '../domain';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import { purgeLocalDrafts } from '../lib/draftStore';
import { Button, Card, Checkbox, EmptyState, Loading, Notice, PageHeader, Pill, TextArea } from '../ui/components';
import { formatWhen } from '../ui/format';

const CONSENT_TEXT: Partial<Record<ConsentPurpose, { label: string; hint: string }>> = {
  coach_sharing: { label: 'Share chosen excerpts with my verified coach', hint: 'Needed to ask a coach for feedback. Turning it off cancels any open request.' },
  ai_processing: { label: 'Let my coach use AI to organize what I share', hint: 'Only the excerpt you share for that request. Never your diary. A coach always reviews.' },
  voice_recording: { label: 'Allow optional voice answers', hint: 'Separate from everything else. Turning it off schedules your recordings for deletion.' },
  email_notifications: { label: 'Email me reminders and invites', hint: 'Neutral reminders with a secure link only — never your reflections or coach feedback.' },
};

export function Settings() {
  const { api, viewer, config, bump } = useApp();
  const navigate = useNavigate();
  const { data, error } = useLoad(() => api.getSettings());
  const act = useAction();
  const [prefs, setPrefs] = useState<{ inAppEnabled: boolean; emailReminders: boolean; quietHoursStart: number; quietHoursEnd: number } | null>(null);
  const [concern, setConcern] = useState('');
  const [concernDone, setConcernDone] = useState<string | null>(null);
  useEffect(() => {
    if (data) setPrefs({ inAppEnabled: data.prefs.inAppEnabled, emailReminders: data.prefs.emailReminders, quietHoursStart: data.prefs.quietHoursStart, quietHoursEnd: data.prefs.quietHoursEnd });
  }, [data]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data || !prefs || !viewer) return <Loading />;
  const active = (p: ConsentPurpose) => data.consents.find((c) => c.purpose === p && !c.withdrawnAt && c.subjectUserId === viewer.userId);
  const purposes: ConsentPurpose[] = viewer.athleteId ? ['coach_sharing', 'ai_processing', ...(config.flags.voice ? (['voice_recording'] as const) : []), 'email_notifications'] : ['email_notifications'];
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" subtitle="Access, consent, notifications and your data." />

      <Card className="space-y-3">
        <h2 className="font-bold">Access & consents</h2>
        {purposes.map((p) => {
          const c = active(p);
          const t = CONSENT_TEXT[p]!;
          return (
            <div key={p} className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t.label}</p>
                <p className="text-sm text-ink-soft">{t.hint}</p>
              </div>
              {c ? (
                <Button variant="secondary" busy={act.busy} onClick={() => act.run(() => api.withdrawConsent(c.id))}>
                  Turn off
                </Button>
              ) : (
                <Button busy={act.busy} onClick={() => act.run(() => api.recordConsent(p))}>
                  Turn on
                </Button>
              )}
            </div>
          );
        })}
        <details className="text-sm">
          <summary className="cursor-pointer text-brand">All consent records</summary>
          <ul className="mt-2 space-y-1">
            {data.consents.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {c.purpose.replaceAll('_', ' ')} · {c.policyVersion} · {formatWhen(c.grantedAt)}
                  {c.actorUserId !== c.subjectUserId ? ' · given by guardian' : ''}
                </span>
                {c.withdrawnAt ? (
                  <Pill>withdrawn</Pill>
                ) : ['guardian_consent', 'athlete_assent', 'privacy_notice'].includes(c.purpose) ? (
                  <Button variant="ghost" onClick={() => window.confirm('Withdrawing this pauses the account and starts the withdrawal process. Continue?') && act.run(() => api.withdrawConsent(c.id))}>
                    Withdraw
                  </Button>
                ) : (
                  <Pill tone="ok">active</Pill>
                )}
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Notifications</h2>
        <Checkbox label="In-app notifications" checked={prefs.inAppEnabled} onChange={(v) => setPrefs({ ...prefs, inAppEnabled: v })} />
        <Checkbox label="Email reminders" hint={active('email_notifications') ? undefined : 'Turn on email consent above first.'} checked={prefs.emailReminders} onChange={(v) => setPrefs({ ...prefs, emailReminders: v })} />
        <div className="flex flex-wrap gap-3">
          {(['quietHoursStart', 'quietHoursEnd'] as const).map((k) => (
            <label key={k} className="flex flex-col text-sm font-semibold">
              {k === 'quietHoursStart' ? 'Quiet from' : 'Quiet until'}
              <select className="min-h-11 rounded-lg border border-line bg-white px-2" value={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="text-sm text-ink-soft">Text messages (SMS) are not available in this pilot.</p>
        <Button busy={act.busy} onClick={() => act.run(() => api.updatePreferences(prefs))}>
          Save notification settings
        </Button>
        <h3 className="pt-2 font-semibold">Recent notifications</h3>
        {data.notifications.length === 0 ? (
          <p className="text-sm text-ink-soft">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.notifications.slice(0, 10).map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2">
                <button type="button" className="text-left text-brand underline" onClick={async () => { await api.markNotificationRead(n.id); bump(); navigate(n.linkPath); }}>
                  {n.readAt ? '' : '● '}
                  {n.title}
                </button>
                <span className="text-xs text-ink-soft">{deliveryLabel(n)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.entitlement ? (
        <Card>
          <h2 className="font-bold">Plan</h2>
          <p className="mt-1 text-sm">
            {data.entitlement.fundingSource === 'sponsorship' ? 'Covered by a sponsor.' : data.entitlement.active ? 'Family plan active.' : 'Free pilot access.'} Coach responses are always free.
          </p>
          <p className="text-xs text-ink-soft">Billing is {config.flags.billing ? 'in test mode' : 'turned off'} in this build. No prices are set and no payment can be taken.</p>
        </Card>
      ) : null}

      <Card className="space-y-3">
        <h2 className="font-bold">Your data</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            busy={act.busy}
            onClick={async () => {
              const out = await act.run(() => api.exportMyData());
              if (!out) return;
              const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `loop-export-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download my data
          </Button>
          {config.flags.voice ? (
            <Button variant="secondary" onClick={() => window.confirm('Delete all your voice recordings and transcripts?') && act.run(() => api.requestDeletion('voice_only'))}>
              Delete voice recordings
            </Button>
          ) : null}
          <Button
            variant="danger"
            onClick={() => {
              if (!window.confirm('Request deletion of your account, reflections, recordings and anything derived from them? Some records may be kept only where the approved retention policy requires it.')) return;
              void act.run(() => api.requestDeletion('account')).then(() => purgeLocalDrafts());
            }}
          >
            Request account deletion
          </Button>
        </div>
        {data.deletionRequests.length ? (
          <ul className="text-sm">
            {data.deletionRequests.map((d) => (
              <li key={d.id}>
                Deletion ({d.scope.replace('_', ' ')}) requested {formatWhen(d.createdAt)} — {d.state.replace('_', ' ')}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-bold">Report a concern</h2>
        <p className="text-sm text-ink-soft">
          Goes to the pilot’s named safeguarding contact, who reviews it as a person. Loop is not monitored around the clock — if anyone is in immediate danger, contact local emergency services.
        </p>
        {concernDone ? (
          <Notice tone="success">{concernDone}</Notice>
        ) : (
          <>
            <TextArea label="What happened?" value={concern} onChange={setConcern} max={2000} required rows={3} />
            <Button
              variant="secondary"
              disabled={!concern.trim()}
              busy={act.busy}
              onClick={async () => {
                const r = await act.run(() => api.reportConcern({ description: concern, subjectAthleteId: viewer.athleteId, referenceType: 'other', referenceId: null }));
                if (r) setConcernDone(r.routed ? 'Sent to the safeguarding contact. They will follow up.' : 'Saved. No safeguarding contact is configured yet in this environment.');
              }}
            >
              Send report
            </Button>
          </>
        )}
      </Card>

      <Card>
        <h2 className="font-bold">Activity on your account</h2>
        {data.myAudit.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.myAudit.slice(0, 15).map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2">
                <span>{e.action.replaceAll('_', ' ').replace('.', ': ')}</span>
                <span className="text-xs text-ink-soft">{formatWhen(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </div>
  );
}
