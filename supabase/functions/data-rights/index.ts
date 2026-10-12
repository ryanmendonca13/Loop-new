// Edge Function: data-rights. Executes an APPROVED deletion request: DB erasure (process_deletion),
// private storage objects (voice), then the auth user for full-account deletion. Callable only by a
// pilot operator with the CRON/ops secret after the documented review; never by end users directly.
import { createClient } from '@supabase/supabase-js';
import { json } from '../_shared/env.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('OPS_SECRET')}`) return json({ ok: false }, 401);
  const { deletion_request_id } = (await req.json().catch(() => ({}))) as { deletion_request_id?: string };
  if (!deletion_request_id) return json({ ok: false, reason: 'invalid_request' }, 400);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('process_deletion', { p_request_id: deletion_request_id });
  if (error) return json({ ok: false, reason: 'not_processed' }, 409);
  const r = data as { storage_paths: string[]; subject_user_id: string; scope: string };
  if (r.storage_paths.length) await admin.storage.from('voice').remove(r.storage_paths);
  if (r.scope === 'account') await admin.auth.admin.deleteUser(r.subject_user_id);
  return json({ ok: true, removed_objects: r.storage_paths.length });
});
