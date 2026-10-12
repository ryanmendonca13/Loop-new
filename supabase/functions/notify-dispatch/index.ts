// Edge Function: notify-dispatch (scheduled). Sends pending EMAIL jobs through the configured provider
// (mock by default — records, never sends). Requires consent + preference; respects quiet hours; retries
// with backoff; dedupes by job id as provider idempotency key. SMS is disabled.
import { createClient } from '@supabase/supabase-js';
import { readEnv, json } from '../_shared/env.ts';
import { dispatchJob, mockEmailProvider, type EmailProvider } from '../_shared/notify.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return json({ ok: false }, 401);
  const env = readEnv((k) => Deno.env.get(k));
  const provider: EmailProvider = mockEmailProvider(); // A real provider adapter is added only after approval.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: jobs } = await admin.from('notification_jobs').select('*').eq('state', 'pending').eq('channel', 'email').lte('due_at', new Date().toISOString()).limit(100);
  const results = [];
  for (const j of jobs ?? []) {
    const [{ data: prefs }, { data: user }, { data: consent }] = await Promise.all([
      admin.from('notification_preferences').select('*').eq('user_id', j.recipient_user_id).maybeSingle(),
      admin.auth.admin.getUserById(j.recipient_user_id),
      admin.from('consent_records').select('id').eq('id', j.consent_record_id).is('withdrawn_at', null).maybeSingle(),
    ]);
    const u = await dispatchJob({ id: j.id, channel: j.channel, recipientEmail: user?.user?.email ?? null, title: j.title, linkPath: j.link_path, attemptCount: j.attempt_count,
      prefs: { quietHoursStart: prefs?.quiet_hours_start ?? 21, quietHoursEnd: prefs?.quiet_hours_end ?? 8, timezone: 'UTC', emailReminders: !!prefs?.email_reminders }, consentActive: !!consent }, provider, env.appBaseUrl, new Date());
    const patch = u.state === 'deferred' ? { due_at: u.dueAt } : { state: u.state, ...('attemptCount' in u ? { attempt_count: u.attemptCount } : {}), ...('providerMessageId' in u ? { provider_message_id: u.providerMessageId } : {}), ...('lastError' in u ? { last_error: u.lastError } : {}), ...('dueAt' in u ? { due_at: u.dueAt } : {}) };
    await admin.from('notification_jobs').update(patch).eq('id', j.id).eq('state', 'pending');
    results.push(u.state);
  }
  return json({ ok: true, processed: results.length });
});
