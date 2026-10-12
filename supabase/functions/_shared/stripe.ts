/**
 * Stripe webhook verification (test mode only). Verifies the Stripe-Signature header (HMAC-SHA256 over
 * "<t>.<payload>") with a timestamp tolerance, using WebCrypto — no provisioning from return URLs.
 */
import type { StripeLikeEvent } from '../../../src/domain/billing';

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function signStripePayload(secret: string, payload: string, t: number): Promise<string> {
  return `t=${t},v1=${await hmacHex(secret, `${t}.${payload}`)}`;
}

export async function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || sigs.length === 0) return false;
  const expected = await hmacHex(secret, `${t}.${payload}`);
  return sigs.some((s) => safeEqual(s, expected));
}

interface RawStripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: { id?: string; subscription?: string; customer?: string; status?: string; current_period_end?: number; metadata?: Record<string, string> } };
}

const HANDLED = new Set(['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);

/** Maps a raw Stripe event to the domain shape. Athlete/payer ids come from server-set metadata on checkout. */
export function toDomainEvent(raw: RawStripeEvent): StripeLikeEvent | null {
  if (raw.livemode) throw new Error('live_event_rejected');
  if (!HANDLED.has(raw.type)) return null;
  const o = raw.data.object;
  const subscriptionId = raw.type.startsWith('customer.subscription') ? o.id : o.subscription;
  const athleteId = o.metadata?.athlete_id;
  const payerUserId = o.metadata?.payer_user_id;
  if (!subscriptionId || !o.customer || !athleteId || !payerUserId) return null;
  return {
    id: raw.id,
    type: raw.type as StripeLikeEvent['type'],
    created: raw.created,
    data: { subscriptionId, customerId: o.customer, status: o.status as StripeLikeEvent['data']['status'], athleteId, payerUserId, currentPeriodEnd: o.current_period_end },
  };
}
