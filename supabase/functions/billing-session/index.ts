// Edge Function: billing-session (TEST MODE ONLY; off unless BILLING_ENABLED=true and an approved test price exists).
// Creates a Stripe Checkout or Billing Portal session for an ADULT payer. Refuses when the athlete is
// covered by a sponsor or already subscribed (no double billing). Entitlement is granted later only by
// verified webhooks — never by the checkout return URL.
import { createClient } from '@supabase/supabase-js';
import { readEnv, json, CORS_HEADERS } from '../_shared/env.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

async function stripe(path: string, key: string, form: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  if (!res.ok) throw new Error(`stripe_${res.status}`);
  return (await res.json()) as { url: string };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const env = readEnv((k) => Deno.env.get(k));
  const price = Deno.env.get('STRIPE_PRICE_ID_FAMILY');
  if (!env.billingEnabled || !env.stripeSecretKey || !price) return json({ ok: false, reason: 'Billing is not enabled. No price has been approved.' }, 503);
  const auth = req.headers.get('authorization');
  if (!auth) return json({ ok: false }, 401);
  const { athlete_id, kind } = (await req.json().catch(() => ({}))) as { athlete_id?: string; kind?: 'checkout' | 'portal' };
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { authorization: auth } } });
  const { data: user } = await sb.auth.getUser();
  const { data: profile } = await sb.from('profiles').select('eligibility_band').eq('id', user.user?.id ?? '').maybeSingle();
  if (!user.user || profile?.eligibility_band !== '18_plus') return json({ ok: false, reason: 'An adult payer is required.' }, 403);
  // my_entitlement re-checks that the caller is the athlete or an active guardian.
  const { data: ent, error } = await sb.rpc('my_entitlement', { p_athlete_id: athlete_id });
  if (error) return json({ ok: false }, 403);
  if (kind === 'portal') {
    const { data: sub } = await sb.from('subscriptions').select('stripe_customer_id').eq('athlete_id', athlete_id).eq('payer_user_id', user.user.id).maybeSingle();
    if (!sub?.stripe_customer_id) return json({ ok: false, reason: 'No subscription to manage.' }, 404);
    return json({ ok: true, url: (await stripe('billing_portal/sessions', env.stripeSecretKey, { customer: sub.stripe_customer_id, return_url: `${env.appBaseUrl}/settings` })).url });
  }
  if (ent.funding_source === 'sponsorship') return json({ ok: false, reason: 'Covered by a sponsor. No payment needed.' }, 409);
  if (ent.active) return json({ ok: false, reason: 'Already subscribed. Manage it instead.' }, 409);
  const session = await stripe('checkout/sessions', env.stripeSecretKey, {
    mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1',
    success_url: `${env.appBaseUrl}/settings?billing=processing`, cancel_url: `${env.appBaseUrl}/settings`,
    'subscription_data[metadata][athlete_id]': athlete_id!, 'subscription_data[metadata][payer_user_id]': user.user.id,
    'metadata[athlete_id]': athlete_id!, 'metadata[payer_user_id]': user.user.id,
  });
  return json({ ok: true, url: session.url });
});
