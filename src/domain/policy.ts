/**
 * Pure authorization predicates. These mirror the database RLS/RPC rules in
 * supabase/migrations and are used by the synthetic demo backend. UI visibility
 * is never authority: every mutation path re-checks these server-side.
 */
import type {
  Athlete,
  AudienceMember,
  AudienceSnapshot,
  CoachRelationship,
  ConsentRecord,
  EligibilityBand,
  GuardianLink,
  LoopRequest,
  ParentBrief,
  Profile,
  SharingGrant,
  Timestamp,
} from './types';
import type { UUID } from './ids';

export function isMinorBand(band: EligibilityBand): boolean {
  return band !== '18_plus';
}

export function isActiveGuardianLink(link: GuardianLink): boolean {
  return link.status === 'active' && link.revokedAt === null && link.guardianUserId !== null && link.verifiedAt !== null;
}

export function activeGuardianLinksFor(links: GuardianLink[], athleteId: UUID): GuardianLink[] {
  return links.filter((l) => l.athleteId === athleteId && isActiveGuardianLink(l));
}

export function isActiveVerifiedCoach(rel: CoachRelationship | undefined | null): rel is CoachRelationship {
  return !!rel && rel.active && rel.revokedAt === null && rel.verificationState === 'verified';
}

export function hasActiveConsent(consents: ConsentRecord[], subjectUserId: UUID, purpose: ConsentRecord['purpose']): boolean {
  return consents.some((c) => c.subjectUserId === subjectUserId && c.purpose === purpose && c.withdrawnAt === null);
}

/** Diary content (reflection, audio) is only collected once the account is active. */
export function canWriteDiary(athlete: Athlete | undefined, profile: Profile | undefined): boolean {
  return !!athlete && !!profile && athlete.activationState === 'active' && profile.accountState === 'active';
}

export interface ActivationFacts {
  band: EligibilityBand;
  consents: ConsentRecord[];
  athleteUserId: UUID;
  guardianLinks: GuardianLink[];
  athleteId: UUID;
}

export type ActivationGap = 'verified_guardian_link' | 'guardian_consent' | 'athlete_assent' | 'privacy_notice' | 'under_13_review';

/**
 * Conservative pilot policy (see DECISIONS.md): under-18 activation requires a verified guardian
 * link, recorded guardian consent and athlete assent. Under-13 is blocked pending owner/legal review.
 */
export function activationGaps(f: ActivationFacts): ActivationGap[] {
  const gaps: ActivationGap[] = [];
  if (!hasActiveConsent(f.consents, f.athleteUserId, 'privacy_notice')) gaps.push('privacy_notice');
  if (f.band === '18_plus') return gaps;
  if (f.band === 'under_13') gaps.push('under_13_review');
  if (activeGuardianLinksFor(f.guardianLinks, f.athleteId).length === 0) gaps.push('verified_guardian_link');
  if (!hasActiveConsent(f.consents, f.athleteUserId, 'guardian_consent')) gaps.push('guardian_consent');
  if (!hasActiveConsent(f.consents, f.athleteUserId, 'athlete_assent')) gaps.push('athlete_assent');
  return gaps;
}

export interface ExchangeGateFacts {
  athlete: Athlete;
  profile: Profile;
  relationship: CoachRelationship | undefined;
  guardianLinks: GuardianLink[];
  consents: ConsentRecord[];
}

export type ExchangeGateFailure =
  | 'account_not_active'
  | 'coach_not_verified'
  | 'second_adult_missing'
  | 'second_adult_not_linked_guardian'
  | 'coach_sharing_consent_missing';

/** Gates checked at request creation AND again at publication (fresh server check). */
export function coachExchangeGateFailures(f: ExchangeGateFacts): ExchangeGateFailure[] {
  const out: ExchangeGateFailure[] = [];
  if (!canWriteDiary(f.athlete, f.profile)) out.push('account_not_active');
  if (!isActiveVerifiedCoach(f.relationship)) out.push('coach_not_verified');
  if (!hasActiveConsent(f.consents, f.profile.id, 'coach_sharing')) out.push('coach_sharing_consent_missing');
  if (isMinorBand(f.profile.eligibilityBand)) {
    const second = f.relationship?.secondAdultUserId ?? null;
    if (!second) out.push('second_adult_missing');
    else {
      // Default approved policy: the second adult must be a linked, verified guardian.
      const ok = activeGuardianLinksFor(f.guardianLinks, f.athlete.id).some((l) => l.guardianUserId === second);
      if (!ok) out.push('second_adult_not_linked_guardian');
    }
  }
  return out;
}

export const GATE_MESSAGES: Record<ExchangeGateFailure, string> = {
  account_not_active: 'Your account needs to be active before you can share with a coach.',
  coach_not_verified: 'This coach has not been verified yet. Shared content stays private until they are.',
  second_adult_missing:
    'A verified second adult (your linked guardian) must be able to see coach exchanges. Reconnect a guardian to continue.',
  second_adult_not_linked_guardian:
    'The second adult on this coach connection is no longer an active linked guardian. Reconnect a guardian to continue.',
  coach_sharing_consent_missing: 'Sharing with a coach needs your consent first (Settings → Access & consents).',
};

/** Deterministic, non-cryptographic fingerprint used to detect audience changes between preview and submit. */
export function fingerprint(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function buildAudience(members: AudienceMember[], capturedAt: Timestamp): AudienceSnapshot {
  const sorted = [...members].sort((a, b) => (a.userId + a.role).localeCompare(b.userId + b.role));
  const hash = fingerprint(JSON.stringify(sorted.map((m) => [m.userId, m.role])));
  return { members: sorted, hash, capturedAt };
}

export interface RequestReadFacts {
  viewerUserId: UUID;
  request: LoopRequest;
  athleteUserId: UUID;
  relationship: CoachRelationship | undefined;
  guardianLinks: GuardianLink[];
}

/** Who may read a shared coaching request/response (the shared exchange, never the whole diary). */
export function canReadSharedExchange(f: RequestReadFacts): 'athlete' | 'coach' | 'second_adult' | null {
  if (f.viewerUserId === f.athleteUserId) return 'athlete';
  if (f.relationship && f.relationship.coachUserId === f.viewerUserId && isActiveVerifiedCoach(f.relationship)) {
    return 'coach';
  }
  const inAudience = f.request.audience.members.some((m) => m.userId === f.viewerUserId && m.role === 'second_adult');
  if (inAudience) {
    const stillLinked = activeGuardianLinksFor(f.guardianLinks, f.request.athleteId).some(
      (l) => l.guardianUserId === f.viewerUserId,
    );
    if (stillLinked) return 'second_adult';
  }
  return null;
}

export function canGuardianReadBrief(viewerUserId: UUID, brief: ParentBrief, links: GuardianLink[]): boolean {
  if (brief.state !== 'published') return false;
  const link = links.find((l) => l.id === brief.guardianLinkId);
  return !!link && isActiveGuardianLink(link) && link.guardianUserId === viewerUserId;
}

export function hasActiveGrant(
  grants: SharingGrant[],
  recordId: UUID,
  recipientUserId: UUID,
  surface: SharingGrant['surface'],
): boolean {
  return grants.some(
    (g) => g.recordId === recordId && g.recipientUserId === recipientUserId && g.surface === surface && g.revokedAt === null,
  );
}
