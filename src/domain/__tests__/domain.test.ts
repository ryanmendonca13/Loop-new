import { describe, expect, it } from 'vitest';
import {
  CORE_PROMPT_MOMENT_BACK,
  CORE_PROMPT_WELL,
  DomainError,
  ACTIVE_REQUEST_STATES,
  accountMachine,
  activationGaps,
  assignmentMachine,
  buildAudience,
  buildAuditEvent,
  canReadSharedExchange,
  canTransition,
  checkInviteRedemption,
  coachExchangeGateFailures,
  emailHash,
  feedbackDraftMachine,
  inviteExpiry,
  loopLabel,
  loopRequestMachine,
  organizeSolo,
  redactForLog,
  reflectionDraftSchema,
  reflectionSubmitSchema,
  responseDueAt,
  tokenHash,
  transition,
  generateToken,
  firstSentence,
} from '../index';
import type { Athlete, CoachInvite, CoachRelationship, ConsentRecord, GuardianLink, LoopRequest, Profile, Reflection } from '../index';

const NOW = new Date('2026-10-12T15:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function profile(band: Profile['eligibilityBand'], state: Profile['accountState'] = 'active'): Profile {
  return { id: id(1), authUserId: id(1), displayName: 'Ava', locale: 'en', timezone: 'America/Toronto', eligibilityBand: band, accountState: state, createdAt: '', updatedAt: '' };
}
const athlete: Athlete = { id: id(10), userId: id(1), activationState: 'active', sportPreference: 'soccer', createdAt: '', updatedAt: '' };
function consent(purpose: ConsentRecord['purpose'], withdrawn = false): ConsentRecord {
  return { id: id(Math.floor(Math.random() * 1e6)), subjectUserId: id(1), actorUserId: id(1), purpose, policyVersion: 'v1', scope: [], grantedAt: '', withdrawnAt: withdrawn ? NOW.toISOString() : null, provenance: 'test' };
}
const guardianLink = (over: Partial<GuardianLink> = {}): GuardianLink => ({
  id: id(20), guardianUserId: id(2), athleteId: id(10), inviteContactHint: 'p•••@x.test', status: 'active', verifiedBy: id(99), verifiedAt: NOW.toISOString(), verificationEvidenceRef: 'ev-1', consentScope: ['coach_exchange_visibility'], revokedAt: null, createdAt: '', updatedAt: '', ...over,
});
const rel = (over: Partial<CoachRelationship> = {}): CoachRelationship => ({
  id: id(30), athleteId: id(10), coachUserId: id(3), inviteId: null, verificationState: 'verified', verifiedBy: id(99), verifiedAt: '', verificationEvidenceRef: 'ev', secondAdultUserId: id(2), scope: ['coach_request'], active: true, revokedAt: null, createdAt: '', updatedAt: '', ...over,
});

describe('core prompts', () => {
  it('uses the exact prompt texts', () => {
    expect(CORE_PROMPT_WELL).toBe('What did you do well?');
    expect(CORE_PROMPT_MOMENT_BACK).toBe('What moment would you like back?');
  });
});

describe('reflection schemas', () => {
  it('keeps missing mood as null, never zero', () => {
    const r = reflectionDraftSchema.parse({ answerWell: 'x', answerMomentBack: '', supportRequest: null, mood: null });
    expect(r.mood).toBeNull();
    expect(reflectionDraftSchema.safeParse({ answerWell: 'x', answerMomentBack: '', supportRequest: null, mood: 0 }).success).toBe(false);
  });
  it('requires both answers to submit and enforces length limits', () => {
    expect(reflectionSubmitSchema.safeParse({ answerWell: '  ', answerMomentBack: 'a', supportRequest: null, mood: null, idempotencyKey: 'abcdefgh1' }).success).toBe(false);
    expect(reflectionSubmitSchema.safeParse({ answerWell: 'a'.repeat(1201), answerMomentBack: 'a', supportRequest: null, mood: null, idempotencyKey: 'abcdefgh1' }).success).toBe(false);
    const ok = reflectionSubmitSchema.parse({ answerWell: ' good\u0007 ', answerMomentBack: 'b', supportRequest: null, mood: 3, idempotencyKey: 'abcdefgh1' });
    expect(ok.answerWell).toBe('good');
  });
});

describe('state machines', () => {
  it('loop request cannot skip publication to closure', () => {
    expect(canTransition(loopRequestMachine, 'waiting_for_coach', 'closed')).toBe(false);
    expect(canTransition(loopRequestMachine, 'published', 'athlete_acknowledged')).toBe(true);
    expect(() => transition(loopRequestMachine, 'expired', 'published')).toThrow(DomainError);
  });
  it('active request states match the DB partial index', () => {
    expect([...ACTIVE_REQUEST_STATES].sort()).toEqual(['queued', 'response_draft', 'waiting_for_coach']);
  });
  it('submitted assignment is terminal; feedback drafts must be reviewed before publish', () => {
    expect(canTransition(assignmentMachine, 'submitted', 'draft')).toBe(false);
    expect(canTransition(feedbackDraftMachine, 'ai_suggested', 'published')).toBe(false);
    expect(canTransition(feedbackDraftMachine, 'reviewed', 'published')).toBe(true);
    expect(canTransition(accountMachine, 'pending_guardian', 'active')).toBe(true);
    expect(canTransition(accountMachine, 'closed', 'active')).toBe(false);
  });
});

describe('loop labels', () => {
  it('solo is never a completed loop', () => {
    expect(loopLabel(null)).toBe('Personal reflection');
    expect(loopLabel({ state: 'waiting_for_coach' })).toBe('Awaiting coach');
    expect(loopLabel({ state: 'response_draft' })).toBe('Coach drafting');
    expect(loopLabel({ state: 'published' })).toBe('Coach responded');
    expect(loopLabel({ state: 'athlete_acknowledged' })).toBe('Loop closed');
    expect(loopLabel({ state: 'expired' })).toBe('Request expired');
  });
  it('response window uses next session or 48h default', () => {
    expect(responseDueAt('2026-10-13T10:00:00Z', NOW)).toBe('2026-10-13T10:00:00.000Z');
    expect(responseDueAt(null, NOW)).toBe('2026-10-14T15:00:00.000Z');
    expect(responseDueAt('2026-10-01T10:00:00Z', NOW)).toBe('2026-10-14T15:00:00.000Z');
  });
});

describe('activation (pilot under-18 policy)', () => {
  it('adult needs privacy notice only', () => {
    expect(activationGaps({ band: '18_plus', consents: [consent('privacy_notice')], athleteUserId: id(1), guardianLinks: [], athleteId: id(10) })).toEqual([]);
  });
  it('minor needs verified link, guardian consent and assent', () => {
    expect(activationGaps({ band: '13_17', consents: [consent('privacy_notice')], athleteUserId: id(1), guardianLinks: [guardianLink({ status: 'pending_verification', verifiedAt: null })], athleteId: id(10) })).toEqual([
      'verified_guardian_link', 'guardian_consent', 'athlete_assent',
    ]);
    expect(activationGaps({ band: '13_17', consents: [consent('privacy_notice'), consent('guardian_consent'), consent('athlete_assent')], athleteUserId: id(1), guardianLinks: [guardianLink()], athleteId: id(10) })).toEqual([]);
  });
  it('under-13 always requires review', () => {
    expect(activationGaps({ band: 'under_13', consents: [consent('privacy_notice'), consent('guardian_consent'), consent('athlete_assent')], athleteUserId: id(1), guardianLinks: [guardianLink()], athleteId: id(10) })).toContain('under_13_review');
  });
});

describe('Rule of Two gates', () => {
  const base = { athlete, guardianLinks: [guardianLink()], consents: [consent('coach_sharing')] };
  it('passes for a minor with verified coach and linked guardian second adult', () => {
    expect(coachExchangeGateFailures({ ...base, profile: profile('13_17'), relationship: rel() })).toEqual([]);
  });
  it('blocks minor exchange without second adult or with revoked guardian', () => {
    expect(coachExchangeGateFailures({ ...base, profile: profile('13_17'), relationship: rel({ secondAdultUserId: null }) })).toContain('second_adult_missing');
    expect(coachExchangeGateFailures({ ...base, guardianLinks: [guardianLink({ status: 'revoked', revokedAt: NOW.toISOString() })], profile: profile('13_17'), relationship: rel() })).toContain('second_adult_not_linked_guardian');
  });
  it('second adult must be a linked guardian, not any adult', () => {
    expect(coachExchangeGateFailures({ ...base, profile: profile('13_17'), relationship: rel({ secondAdultUserId: id(77) }) })).toContain('second_adult_not_linked_guardian');
  });
  it('adult athletes do not need a second adult', () => {
    expect(coachExchangeGateFailures({ ...base, guardianLinks: [], profile: profile('18_plus'), relationship: rel({ secondAdultUserId: null }) })).toEqual([]);
  });
  it('unverified/suspended coach blocked; withdrawn sharing consent blocked', () => {
    expect(coachExchangeGateFailures({ ...base, profile: profile('18_plus'), relationship: rel({ verificationState: 'identity_pending' }) })).toContain('coach_not_verified');
    expect(coachExchangeGateFailures({ ...base, profile: profile('18_plus'), relationship: rel({ verificationState: 'suspended' }) })).toContain('coach_not_verified');
    expect(coachExchangeGateFailures({ ...base, consents: [consent('coach_sharing', true)], profile: profile('18_plus'), relationship: rel() })).toContain('coach_sharing_consent_missing');
  });
  it('shared exchange visibility: second adult only while still linked; outsiders never', () => {
    const audience = buildAudience([{ userId: id(1), displayName: 'Ava', role: 'athlete' }, { userId: id(3), displayName: 'Coach', role: 'coach' }, { userId: id(2), displayName: 'Parent', role: 'second_adult' }], NOW.toISOString());
    const request = { athleteId: id(10), audience } as LoopRequest;
    const facts = { request, athleteUserId: id(1), relationship: rel(), guardianLinks: [guardianLink()] };
    expect(canReadSharedExchange({ ...facts, viewerUserId: id(2) })).toBe('second_adult');
    expect(canReadSharedExchange({ ...facts, viewerUserId: id(3) })).toBe('coach');
    expect(canReadSharedExchange({ ...facts, viewerUserId: id(55) })).toBeNull();
    expect(canReadSharedExchange({ ...facts, guardianLinks: [guardianLink({ status: 'revoked', revokedAt: NOW.toISOString() })], viewerUserId: id(2) })).toBeNull();
    expect(canReadSharedExchange({ ...facts, relationship: rel({ verificationState: 'suspended' }), viewerUserId: id(3) })).toBeNull();
  });
  it('audience hash changes when audience changes', () => {
    const a = buildAudience([{ userId: id(1), displayName: 'A', role: 'athlete' }], '');
    const b = buildAudience([{ userId: id(1), displayName: 'A', role: 'athlete' }, { userId: id(2), displayName: 'P', role: 'second_adult' }], '');
    expect(a.hash).not.toBe(b.hash);
    expect(buildAudience([{ userId: id(1), displayName: 'renamed', role: 'athlete' }], 'x').hash).toBe(a.hash);
  });
});

describe('coach invites', () => {
  async function invite(over: Partial<CoachInvite> = {}): Promise<{ inv: CoachInvite; token: string }> {
    const token = generateToken();
    return {
      token,
      inv: { id: id(40), athleteId: id(10), coachDisplayName: 'Coach Sam', intendedEmailHash: await emailHash('Coach@Example.test'), intendedEmailHint: 'c•••', tokenHash: await tokenHash(token), expiresAt: inviteExpiry(NOW), redeemedAt: null, redeemedBy: null, revokedAt: null, createdBy: id(1), createdAt: NOW.toISOString(), ...over },
    };
  }
  it('tokens are high entropy and never stored in plaintext', async () => {
    const { inv, token } = await invite();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(inv.tokenHash).not.toContain(token);
  });
  it('accepts valid redemption (case-insensitive email)', async () => {
    const { inv, token } = await invite();
    expect(await checkInviteRedemption(inv, token, 'coach@example.test', NOW)).toBeNull();
  });
  it('rejects replay, expiry, revocation, mismatch and forged tokens', async () => {
    const { inv, token } = await invite();
    expect(await checkInviteRedemption({ ...inv, redeemedAt: NOW.toISOString() }, token, 'coach@example.test', NOW)).toBe('already_redeemed');
    expect(await checkInviteRedemption(inv, token, 'coach@example.test', new Date(NOW.getTime() + 8 * 86400000))).toBe('expired');
    expect(await checkInviteRedemption({ ...inv, revokedAt: NOW.toISOString() }, token, 'coach@example.test', NOW)).toBe('revoked');
    expect(await checkInviteRedemption(inv, token, 'other@example.test', NOW)).toBe('email_mismatch');
    expect(await checkInviteRedemption(inv, generateToken(), 'coach@example.test', NOW)).toBe('not_found');
  });
});

describe('solo organizer', () => {
  const r: Reflection = { id: id(50), athleteId: id(10), assignmentId: null, promptVersionId: id(60), answerWell: 'I kept my first touch clean under pressure. Then more.', answerMomentBack: 'I hesitated before the shot in the second half.', supportRequest: null, mood: null, state: 'submitted', submittedAt: NOW.toISOString(), version: 1, revisionOf: null, idempotencyKey: null, createdAt: '', updatedAt: '', authorId: id(1) };
  it('uses only athlete words and leaves NEXT for the athlete', () => {
    const o = organizeSolo(r, null);
    expect(o.now.text).toBe('I hesitated before the shot in the second half.');
    expect(o.strength.text).toBe('I kept my first touch clean under pressure.');
    expect(o.nextScaffold.action).toBe('');
    expect(o.disclaimer).toMatch(/not coach feedback/);
    expect(o.suggestedCategories.map((c) => c.category)).toEqual(expect.arrayContaining(['technical', 'mental_confidence']));
  });
  it('firstSentence truncates long text', () => {
    expect(firstSentence('a'.repeat(300)).length).toBeLessThanOrEqual(200);
  });
});

describe('audit and logs', () => {
  it('refuses raw content keys in audit metadata', () => {
    expect(() => buildAuditEvent({ actorUserId: id(1), action: 'x', targetType: 't', targetIds: [], purpose: 'p', metadata: { answer_text: 'secret diary' }, now: NOW })).toThrow();
    expect(buildAuditEvent({ actorUserId: id(1), action: 'x', targetType: 't', targetIds: [], purpose: 'p', metadata: { state: 'published' }, now: NOW }).metadata.state).toBe('published');
  });
  it('redacts emails, phones and secrets from logs', () => {
    const out = redactForLog({ msg: 'mail a@b.co or +1 (416) 555-0100 with sk_test_abc123', body: 'diary' }) as Record<string, string>;
    expect(out.msg).toBe('mail [email] or [phone] with [secret]');
    expect(out.body).toBe('[redacted]');
  });
});
