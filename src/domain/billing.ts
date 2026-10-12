/**
 * Billing reconciliation (Stripe TEST MODE only, off by default). Entitlements are computed
 * server-side from verified webhook events, deduplicated by event id and ordered by event creation
 * time — never from a checkout return URL. A family covered by an active sponsorship is never charged.
 * Coach responses are always free and never gated by billing.
 */
import type { Entitlement, Sponsorship, Subscription } from './types';
import type { UUID } from './ids';
import { DomainError } from './errors';

export interface StripeLikeEvent {
  id: string;
  type:
    | 'checkout.session.completed'
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted'
    | 'invoice.paid'
    | 'invoice.payment_failed';
  created: number; // unix seconds
  data: {
    subscriptionId: string;
    customerId: string;
    status?: Subscription['status'];
    athleteId: UUID;
    payerUserId: UUID;
    currentPeriodEnd?: number;
  };
}

export interface BillingState {
  processedEventIds: Set<string>;
  subscriptions: Map<string, Subscription>; // by stripe subscription id
}

export function emptyBillingState(): BillingState {
  return { processedEventIds: new Set(), subscriptions: new Map() };
}

const ENTITLING: Subscription['status'][] = ['active', 'trialing'];

function statusFromEvent(e: StripeLikeEvent, prev: Subscription | undefined): Subscription['status'] {
  switch (e.type) {
    case 'customer.subscription.deleted':
      return 'canceled';
    case 'invoice.payment_failed':
      return 'past_due';
    case 'invoice.paid':
      return 'active';
    case 'checkout.session.completed':
      // Checkout completion alone does not prove payment; wait for subscription/invoice events.
      return prev?.status ?? 'incomplete';
    default:
      return e.data.status ?? prev?.status ?? 'incomplete';
  }
}

/** Applies one verified event. Returns false for duplicates or stale (out-of-order) events. */
export function applyBillingEvent(state: BillingState, e: StripeLikeEvent): boolean {
  if (state.processedEventIds.has(e.id)) return false;
  state.processedEventIds.add(e.id);
  const prev = state.subscriptions.get(e.data.subscriptionId);
  if (prev && e.created < prev.lastEventCreated) return false; // older than what we have: ignore
  if (prev?.status === 'canceled' && e.type !== 'customer.subscription.created') {
    // A canceled subscription is not resurrected by a late, non-creation event.
    return false;
  }
  state.subscriptions.set(e.data.subscriptionId, {
    id: prev?.id ?? crypto.randomUUID(),
    payerUserId: e.data.payerUserId,
    athleteId: e.data.athleteId,
    stripeCustomerId: e.data.customerId,
    stripeSubscriptionId: e.data.subscriptionId,
    status: statusFromEvent(e, prev),
    lastEventCreated: e.created,
    currentPeriodEnd: e.data.currentPeriodEnd ? new Date(e.data.currentPeriodEnd * 1000).toISOString() : prev?.currentPeriodEnd ?? null,
    updatedAt: new Date(e.created * 1000).toISOString(),
  });
  return true;
}

export function activeSponsorship(sponsorships: Sponsorship[], athleteId: UUID, at: Date): Sponsorship | undefined {
  const t = at.toISOString();
  return sponsorships.find(
    (s) => s.athleteId === athleteId && s.status === 'active' && s.startsAt <= t && (s.endsAt === null || t < s.endsAt),
  );
}

export function computeEntitlement(athleteId: UUID, subs: Subscription[], sponsorships: Sponsorship[], at: Date): Entitlement {
  const sponsor = activeSponsorship(sponsorships, athleteId, at);
  if (sponsor) {
    return { athleteId, active: true, fundingSource: 'sponsorship', effectiveFrom: sponsor.startsAt, effectiveTo: sponsor.endsAt };
  }
  const sub = subs.find((s) => s.athleteId === athleteId && ENTITLING.includes(s.status));
  if (sub) return { athleteId, active: true, fundingSource: 'family_subscription', effectiveFrom: sub.updatedAt, effectiveTo: sub.currentPeriodEnd };
  return { athleteId, active: false, fundingSource: 'none', effectiveFrom: null, effectiveTo: null };
}

/** Guard before creating a checkout session: never double-bill a sponsored or already-subscribed athlete. */
export function assertCheckoutAllowed(athleteId: UUID, subs: Subscription[], sponsorships: Sponsorship[], at: Date): void {
  if (activeSponsorship(sponsorships, athleteId, at)) {
    throw new DomainError('conflict', 'This athlete is covered by an active sponsorship; no family subscription is needed.');
  }
  if (subs.some((s) => s.athleteId === athleteId && ['active', 'trialing', 'past_due'].includes(s.status))) {
    throw new DomainError('conflict', 'A subscription already exists for this athlete. Manage it instead of starting a new one.');
  }
}

/** When a sponsorship starts while a family subscription is active, the subscription should be scheduled to cancel. */
export function subscriptionsToCancelForSponsorship(athleteId: UUID, subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.athleteId === athleteId && ['active', 'trialing', 'past_due'].includes(s.status));
}
