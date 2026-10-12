// Edge Function: expire-requests (scheduled). Expiry frees the active-request slot but never fabricates closure.
import { createClient } from '@supabase/supabase-js';
import { json } from '../_shared/env.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return json({ ok: false }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('expire_due_requests');
  return error ? json({ ok: false }, 500) : json({ ok: true, expired: data });
});
