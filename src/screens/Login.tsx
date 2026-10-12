import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../app/context';
import { useAction } from '../app/hooks';
import type { DemoBackend } from '../adapters/demo/backend';
import type { SupabaseApi } from '../adapters/supabase/supabaseApi';
import { Button, Card, Notice, PageHeader, TextInput } from '../ui/components';

export function Login() {
  const { api, bump } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { run, busy, error } = useAction();
  if (api.kind === 'demo') {
    const demo = api as unknown as DemoBackend;
    return (
      <div className="space-y-4">
        <PageHeader title="Choose a demo persona" subtitle="Demo mode uses fictional people. There is no real sign-in here." />
        <ul className="grid gap-2">
          {demo.listPersonas().map((p) => (
            <li key={p.id}>
              <Button
                variant="secondary"
                className="w-full justify-between text-left"
                onClick={() => {
                  demo.setPersona(p.id);
                  try {
                    sessionStorage.setItem('loop.demo.persona', p.id);
                  } catch {
                    /* ignore */
                  }
                  bump();
                  navigate('/');
                }}
              >
                <span>{p.displayName}</span>
                <span className="text-sm font-normal text-ink-soft">{p.persona}</span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const sb = api as unknown as SupabaseApi;
  return (
    <div className="space-y-4">
      <PageHeader title="Log in" subtitle="We email you a one-time sign-in link. No password to remember." />
      <Card>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() => sb.sendMagicLink(email));
            if (ok !== undefined) setSent(true);
          }}
        >
          <TextInput label="Email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail} required max={254} />
          <Button type="submit" busy={busy} className="w-full">
            Email me a sign-in link
          </Button>
          {sent ? <Notice tone="success">If that address can sign in, a link is on its way. It expires soon.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </form>
      </Card>
      <p className="text-sm text-ink-soft">Verifying your email proves you control the address. It does not verify that you are a coach or guardian — a person on the pilot team does that.</p>
    </div>
  );
}
