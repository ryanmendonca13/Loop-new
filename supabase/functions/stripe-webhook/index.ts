// Edge Function: stripe-webhook (TEST MODE ONLY, off unless BILLING_ENABLED=true).
// Verifies the signature, dedupes on event id, ignores out-of-order events, never provisions from a
// return URL, and cancels duplicate subscriptions for sponsored athletes (no double billing).
import { createClient } from '@supabase/supabase-js';
import { readEnv, json } from '../_shared/env.ts';
import { toDomainEvent, verifyStripeSignature } from '../_shared/stripe.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

const STATUS: Record<string, string> = { 'customer.subscription.deleted': 'canceled', 'invoice.payment_failed': 'past_due', 'invoice.paid': 'active' };

Deno.serve(async (req) => {
  const env = readEnv((k) => Deno.env.get(k));
  if (!env.billingEnabled || !env.stripeWebhookSecret) return json({ received: false, reason: 'billing_disabled' }, 503);
  const payload = await req.text();
  const ok = await verifyStripeSignature(payload, req.headers.get('stripe-signature'), env.stripeWebhookSecret, Math.floor(Date.now() / 1000));
  if (!ok) return json({ received: false }, 400);
  const raw = JSON.parse(payload);
  const ev = toDomainEvent(raw);
  // Service role is used ONLY here, after signature verification, and only calls billing_* functions.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: fresh } = await admin.rpc('billing_record_event', { p_event_id: raw.id, p_type: raw.type });
  if (!fresh || !ev) return json({ received: true, duplicate: !fresh });
  const status = STATUS[ev.type] ?? ev.data.status ?? 'incomplete';
  await admin.rpc('billing_upsert_subscription', {
    p_stripe_subscription_id: ev.data.subscriptionId, p_customer_id: ev.data.customerId, p_payer: ev.data.payerUserId,
    p_athlete: ev.data.athleteId, p_status: status, p_event_created: ev.created,
    p_period_end: ev.data.currentPeriodEnd ? new Date(ev.data.currentPeriodEnd * 1000).toISOString() : null,
  });
  return json({ received: true });
});
