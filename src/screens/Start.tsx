import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { EligibilityBand } from '../domain';
import { useApp } from '../app/context';
import { useAction } from '../app/hooks';
import { Button, Card, Checkbox, Notice, PageHeader, TextInput } from '../ui/components';

export function Start() {
  const { api, refreshViewer, viewer } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [band, setBand] = useState<EligibilityBand | null>(null);
  const [privacy, setPrivacy] = useState(false);
  const { run, busy, error } = useAction();
  if (viewer?.athleteId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Start as an athlete" />
        <Notice>You already have an athlete profile.</Notice>
        <Button onClick={() => navigate('/')}>Continue</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageHeader title="Start as an athlete" subtitle="No club or team needed." />
      <Card>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!band) return;
            const v = await run(() => api.startAthlete({ displayName: name, eligibilityBand: band, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
            if (v) {
              await refreshViewer();
              navigate(v.accountState === 'active' ? '/home' : '/pending');
            }
          }}
        >
          <TextInput label="What should we call you?" hint="A first name or nickname is fine. It is shown only to people you connect with." value={name} onChange={setName} required max={60} autoComplete="nickname" />
          <fieldset className="space-y-2">
            <legend className="font-semibold">How old are you?</legend>
            <p className="text-sm text-ink-soft">We only store an age group, never your birth date.</p>
            {(
              [
                ['18_plus', '18 or older'],
                ['13_17', '13 to 17'],
                ['under_13', 'Under 13'],
              ] as const
            ).map(([v, label]) => (
              <label key={v} className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3">
                <input type="radio" name="band" value={v} checked={band === v} onChange={() => setBand(v)} className="size-5 accent-[var(--color-brand)]" />
                {label}
              </label>
            ))}
          </fieldset>
          {band && band !== '18_plus' ? (
            <Notice title="A parent or guardian activates your account">
              Until then we only keep your nickname, age group and your guardian’s invite. You can’t write reflections yet.
              {band === 'under_13' ? ' Under-13 use is guardian-led and needs an extra review before it can start in this pilot.' : ''}
            </Notice>
          ) : null}
          <Checkbox
            label="I have read the privacy notice"
            hint="Your reflections are private by default. You decide what to share, with whom, and you can withdraw or export at any time. (Pilot notice — pending owner/legal approval.)"
            checked={privacy}
            onChange={setPrivacy}
          />
          {error ? <Notice tone="error">{error}</Notice> : null}
          {api.kind === 'supabase' ? <p className="text-sm text-ink-soft">You need to be logged in with a verified email first. <a className="underline" href="/login">Log in</a></p> : null}
          <Button type="submit" busy={busy} disabled={!name.trim() || !band || !privacy} className="w-full">
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
