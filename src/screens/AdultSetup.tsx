import { useState } from 'react';
import { Link } from 'react-router';
import { useApp } from '../app/context';
import { useAction, useLoad } from '../app/hooks';
import type { SupabaseApi } from '../adapters/supabase/supabaseApi';
import { Button, Card, Checkbox, Loading, Notice, TextInput } from '../ui/components';

/** Supabase mode only: a signed-in adult (guardian/coach) without a profile creates one. */
export function AdultSetup() {
  const { api, refreshViewer } = useApp();
  const sb = api as unknown as SupabaseApi;
  const { data: session, loading } = useLoad(async () => (await sb.client.auth.getSession()).data.session);
  const [name, setName] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const act = useAction();
  if (loading) return <Loading />;
  if (!session) {
    return (
      <Notice>
        <Link to="/login" className="underline">Log in</Link> with the email address the invite was sent to, then open the invite link again.
      </Notice>
    );
  }
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Create your adult profile</h2>
      <TextInput label="Your name as the athlete knows you" value={name} onChange={setName} required max={60} />
      <Checkbox label="I have read the privacy notice" checked={privacy} onChange={setPrivacy} />
      <Button busy={act.busy} disabled={!name.trim() || !privacy} onClick={async () => { await act.run(() => sb.registerAdult(name, Intl.DateTimeFormat().resolvedOptions().timeZone)); await refreshViewer(); }}>
        Continue
      </Button>
      {act.error ? <Notice tone="error">{act.error}</Notice> : null}
    </Card>
  );
}
