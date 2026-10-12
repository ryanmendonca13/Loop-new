import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useApp } from '../app/context';
import { useAction } from '../app/hooks';
import { Button, Card, Notice, PageHeader, TextInput } from '../ui/components';
import { AdultSetup } from './AdultSetup';

/** Reads the single-use token from the URL fragment (never sent to servers or logs), then clears it. */
function useFragmentToken(): [string, (t: string) => void] {
  const location = useLocation();
  const [token, setToken] = useState('');
  useEffect(() => {
    const m = location.hash.match(/token=([A-Za-z0-9_-]{20,})/);
    if (m?.[1]) {
      setToken(m[1]);
      window.history.replaceState(null, '', location.pathname);
    }
  }, [location.hash, location.pathname]);
  return [token, setToken];
}

export function AcceptInvite({ kind }: { kind: 'guardian' | 'coach' }) {
  const { api, viewer, refreshViewer } = useApp();
  const navigate = useNavigate();
  const [token, setToken] = useFragmentToken();
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const act = useAction();
  const title = kind === 'guardian' ? 'Accept guardian invite' : 'Accept coach invite';
  if (!viewer && api.kind === 'supabase') {
    return (
      <div className="space-y-4">
        <PageHeader title={title} />
        {token ? <p className="text-sm text-ink-soft">Invite link detected. Keep this tab open while you finish signing in.</p> : null}
        <AdultSetup />
      </div>
    );
  }
  if (!viewer) {
    return (
      <div className="space-y-4">
        <PageHeader title={title} />
        <Notice>
          {api.kind === 'demo' ? 'Pick a demo persona first (use “View as” in the demo banner), then open the invite link again.' : 'Log in with the email address the invite was sent to, then open the link again.'}
        </Notice>
        {api.kind !== 'demo' ? <Link to="/login" className="font-semibold text-brand underline">Log in</Link> : null}
        {token ? <p className="text-sm text-ink-soft">Your invite link was detected. Keep this tab open or reopen the link after logging in.</p> : null}
      </div>
    );
  }
  const effective = token || manual.replace(/^.*token=/, '').trim();
  return (
    <div className="space-y-4">
      <PageHeader title={title} subtitle={`Signed in as ${viewer.displayName}.`} />
      <Card className="space-y-3">
        {kind === 'guardian' ? (
          <p>
            Accepting links you to an athlete who invited you. A person on the pilot team then verifies the relationship before you can give consent. You will see coach
            exchanges the athlete shares and support cues — <strong>not</strong> their private diary.
          </p>
        ) : (
          <p>
            Accepting connects you to the athlete who invited you. Before you can see anything they share, a person on the pilot team verifies your identity and the
            athlete’s (and, for minors, a guardian’s) approval. This is not a background check. Responding is free.
          </p>
        )}
        {!token ? <TextInput label="Paste your invite link" value={manual} onChange={setManual} max={400} /> : <Notice>Invite link detected.</Notice>}
        <Button
          busy={act.busy}
          disabled={!effective}
          onClick={async () => {
            const r = await act.run(async () => (kind === 'guardian' ? api.redeemGuardianInvite(effective) : api.redeemCoachInvite(effective)));
            if (r) {
              setToken('');
              await refreshViewer();
              setResult(kind === 'guardian' ? 'Linked. Waiting for the pilot team to verify the relationship.' : 'Accepted. Your verification is pending — you will see requests once a reviewer verifies you.');
            }
          }}
        >
          Accept invite
        </Button>
        {result ? (
          <Notice tone="success" title="Done">
            {result}{' '}
            <button type="button" className="underline" onClick={() => navigate(kind === 'guardian' ? '/guardian' : '/coach')}>
              Continue
            </button>
          </Notice>
        ) : null}
        {act.error ? <Notice tone="error">{act.error}</Notice> : null}
      </Card>
    </div>
  );
}
