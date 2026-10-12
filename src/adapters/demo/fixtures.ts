/**
 * Fictional, synthetic personas and records for demo mode only. No real people, clubs or minors.
 * Fixed UUIDs keep demo links and tests stable.
 */
import { CORE_PROMPT_MOMENT_BACK, CORE_PROMPT_WELL, buildAudience } from '../../domain';
import type { DemoState, DemoUser } from './state';

export const DEMO_IDS = {
  max: 'a0000000-0000-4000-8000-000000000001',
  avaT: 'a0000000-0000-4000-8000-000000000002',
  avaR: 'a0000000-0000-4000-8000-000000000003',
  pat: 'b0000000-0000-4000-8000-000000000001',
  sam: 'c0000000-0000-4000-8000-000000000001',
  kim: 'c0000000-0000-4000-8000-000000000002',
  lee: 'c0000000-0000-4000-8000-000000000003',
  riley: 'c0000000-0000-4000-8000-000000000004',
  jordan: 'd0000000-0000-4000-8000-000000000001',
  // athlete record ids
  maxAthlete: 'e0000000-0000-4000-8000-000000000001',
  avaTAthlete: 'e0000000-0000-4000-8000-000000000002',
  avaRAthlete: 'e0000000-0000-4000-8000-000000000003',
  promptV1: 'f0000000-0000-4000-8000-000000000001',
  relSam: '10000000-0000-4000-8000-000000000001',
  relKim: '10000000-0000-4000-8000-000000000002',
  relLee: '10000000-0000-4000-8000-000000000003',
  linkPat: '20000000-0000-4000-8000-000000000001',
  team: '30000000-0000-4000-8000-000000000001',
  tenant: '30000000-0000-4000-8000-0000000000ff',
} as const;

const iso = (d: Date) => d.toISOString();

export function demoUsers(): DemoUser[] {
  return [
    { id: DEMO_IDS.max, email: 'max@athlete.example.test', displayName: 'Max O.', band: '13_17', accountState: 'active', timezone: 'America/Toronto', staffRoles: [], persona: 'Athlete, 13–17, guardian-activated' },
    { id: DEMO_IDS.avaT, email: 'ava.t@athlete.example.test', displayName: 'Ava T.', band: '18_plus', accountState: 'active', timezone: 'America/Vancouver', staffRoles: [], persona: 'Athlete, adult, no team' },
    { id: DEMO_IDS.avaR, email: 'ava.r@athlete.example.test', displayName: 'Ava R.', band: '13_17', accountState: 'pending_guardian', timezone: 'America/Toronto', staffRoles: [], persona: 'Athlete, 13–17, waiting for guardian' },
    { id: DEMO_IDS.pat, email: 'pat@family.example.test', displayName: 'Pat O.', band: '18_plus', accountState: 'active', timezone: 'America/Toronto', staffRoles: [], persona: "Guardian of Max" },
    { id: DEMO_IDS.sam, email: 'sam@coach.example.test', displayName: 'Coach Sam R.', band: '18_plus', accountState: 'active', timezone: 'America/Toronto', staffRoles: [], persona: 'Coach, verified for Max' },
    { id: DEMO_IDS.kim, email: 'kim@coach.example.test', displayName: 'Coach Kim O.', band: '18_plus', accountState: 'active', timezone: 'America/Toronto', staffRoles: [], persona: 'Coach, identity pending' },
    { id: DEMO_IDS.lee, email: 'lee@coach.example.test', displayName: 'Coach Lee P.', band: '18_plus', accountState: 'active', timezone: 'America/Vancouver', staffRoles: [], persona: 'Coach, verified for Ava T.' },
    { id: DEMO_IDS.riley, email: 'riley@coach.example.test', displayName: 'Coach Riley N.', band: '18_plus', accountState: 'active', timezone: 'America/Toronto', staffRoles: [], persona: 'Coach, not yet invited' },
    { id: DEMO_IDS.jordan, email: 'jordan@pilot.example.test', displayName: 'Jordan B.', band: '18_plus', accountState: 'active', timezone: 'America/Toronto', staffRoles: ['verification_reviewer', 'safeguarding_owner', 'support_admin'], persona: 'Pilot reviewer & safeguarding owner (simulated MFA)' },
  ];
}

export function buildDemoState(now: Date = new Date()): DemoState {
  const day = 86_400_000;
  const t = (offsetDays: number, hour = 18) => {
    const d = new Date(now.getTime() + offsetDays * day);
    d.setUTCHours(hour, 0, 0, 0);
    return iso(d);
  };
  const users = demoUsers();
  const consent = (subject: string, actor: string, purpose: DemoState['consents'][number]['purpose'], n: number) => ({
    id: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`, subjectUserId: subject, actorUserId: actor, purpose,
    policyVersion: 'pilot-2026-10', scope: [], grantedAt: t(-30), withdrawnAt: null, provenance: 'demo_fixture',
  });
  const prevSession = '50000000-0000-4000-8000-000000000001';
  const lastSession = '50000000-0000-4000-8000-000000000002';
  const nextSession = '50000000-0000-4000-8000-000000000003';
  const prevReflection = '60000000-0000-4000-8000-000000000001';
  const prevRequest = '70000000-0000-4000-8000-000000000001';
  const prevDraft = '80000000-0000-4000-8000-000000000001';
  const prevPub = '90000000-0000-4000-8000-000000000001';
  const focus1 = '91000000-0000-4000-8000-000000000001';

  const audience = buildAudience(
    [
      { userId: DEMO_IDS.max, displayName: 'Max O.', role: 'athlete' },
      { userId: DEMO_IDS.sam, displayName: 'Coach Sam R.', role: 'coach' },
      { userId: DEMO_IDS.pat, displayName: 'Pat O.', role: 'second_adult' },
    ],
    t(-6),
  );

  const session = (id: string, title: string, startsAt: string, state: 'scheduled' | 'completed', next: string | null) => ({
    id, athleteId: DEMO_IDS.maxAthlete, teamId: null, tenantId: null, title, sport: 'Soccer', startsAt, timezone: 'America/Toronto',
    state, reflectionDueAt: new Date(new Date(startsAt).getTime() + day).toISOString(), nextSessionAt: next,
    createdAt: t(-10), updatedAt: t(-10), authorId: DEMO_IDS.max, version: 1,
  });

  return {
    schemaVersion: 3,
    users,
    athletes: [
      { id: DEMO_IDS.maxAthlete, userId: DEMO_IDS.max, activationState: 'active', sportPreference: 'Soccer', createdAt: t(-40), updatedAt: t(-30) },
      { id: DEMO_IDS.avaTAthlete, userId: DEMO_IDS.avaT, activationState: 'active', sportPreference: 'Volleyball', createdAt: t(-5), updatedAt: t(-5) },
      { id: DEMO_IDS.avaRAthlete, userId: DEMO_IDS.avaR, activationState: 'pending_guardian', sportPreference: null, createdAt: t(-1), updatedAt: t(-1) },
    ],
    guardianInvites: [
      { id: '21000000-0000-4000-8000-000000000001', athleteId: DEMO_IDS.avaRAthlete, intendedEmailHash: '0'.repeat(64), intendedEmailHint: 'r•••@family.example.test', tokenHash: '1'.repeat(64), expiresAt: t(6), redeemedAt: null, redeemedBy: null, revokedAt: null, createdBy: DEMO_IDS.avaR, createdAt: t(-1) },
    ],
    guardianLinks: [
      { id: DEMO_IDS.linkPat, guardianUserId: DEMO_IDS.pat, athleteId: DEMO_IDS.maxAthlete, inviteContactHint: 'p•••@family.example.test', status: 'active', verifiedBy: DEMO_IDS.jordan, verifiedAt: t(-31), verificationEvidenceRef: 'pilot-call-0001', consentScope: ['coach_exchange_visibility', 'support_cues'], revokedAt: null, createdAt: t(-35), updatedAt: t(-31) },
    ],
    consents: [
      consent(DEMO_IDS.max, DEMO_IDS.max, 'privacy_notice', 1),
      consent(DEMO_IDS.max, DEMO_IDS.pat, 'guardian_consent', 2),
      consent(DEMO_IDS.max, DEMO_IDS.max, 'athlete_assent', 3),
      consent(DEMO_IDS.max, DEMO_IDS.max, 'coach_sharing', 4),
      consent(DEMO_IDS.avaT, DEMO_IDS.avaT, 'privacy_notice', 5),
      consent(DEMO_IDS.avaT, DEMO_IDS.avaT, 'coach_sharing', 6),
      consent(DEMO_IDS.avaR, DEMO_IDS.avaR, 'privacy_notice', 7),
      ...[DEMO_IDS.pat, DEMO_IDS.sam, DEMO_IDS.kim, DEMO_IDS.lee, DEMO_IDS.riley, DEMO_IDS.jordan].map((u, i) => consent(u, u, 'privacy_notice', 10 + i)),
    ],
    sessions: [
      session(prevSession, 'Tuesday training', t(-7), 'completed', t(-1)),
      session(lastSession, 'Thursday practice', t(-1), 'completed', t(2, 15)),
      session(nextSession, 'Saturday game', t(2, 15), 'scheduled', null),
    ],
    promptVersions: [
      { id: DEMO_IDS.promptV1, templateKey: 'core-reflection', version: 1, locale: 'en', questionWell: CORE_PROMPT_WELL, questionMomentBack: CORE_PROMPT_MOMENT_BACK, optionalFields: [{ key: 'mood', label: 'How did it feel overall? (optional)' }, { key: 'support_request', label: 'Anything you want support with? (optional)' }], createdAt: t(-60) },
    ],
    assignments: [
      { id: '51000000-0000-4000-8000-000000000001', athleteId: DEMO_IDS.maxAthlete, sessionId: prevSession, promptVersionId: DEMO_IDS.promptV1, dueAt: t(-6), expected: true, state: 'submitted', createdAt: t(-7), updatedAt: t(-7) },
      { id: '51000000-0000-4000-8000-000000000002', athleteId: DEMO_IDS.maxAthlete, sessionId: lastSession, promptVersionId: DEMO_IDS.promptV1, dueAt: t(0, 23), expected: true, state: 'open', createdAt: t(-1), updatedAt: t(-1) },
      { id: '51000000-0000-4000-8000-000000000003', athleteId: DEMO_IDS.maxAthlete, sessionId: nextSession, promptVersionId: DEMO_IDS.promptV1, dueAt: t(3, 15), expected: true, state: 'upcoming', createdAt: t(-1), updatedAt: t(-1) },
    ],
    reflections: [
      { id: prevReflection, athleteId: DEMO_IDS.maxAthlete, assignmentId: '51000000-0000-4000-8000-000000000001', promptVersionId: DEMO_IDS.promptV1, answerWell: 'I talked to my centre-back and kept our line together.', answerMomentBack: 'I let the winger turn me because I was flat-footed.', supportRequest: null, mood: null, state: 'submitted', submittedAt: t(-7, 20), version: 2, revisionOf: null, idempotencyKey: 'fixture-prev-ref', createdAt: t(-7, 19), updatedAt: t(-7, 20), authorId: DEMO_IDS.max },
    ],
    voiceAssets: [],
    focusVersions: [
      { id: focus1, focusPlanId: DEMO_IDS.maxAthlete, athleteId: DEMO_IDS.maxAthlete, now: 'I let the winger turn me because I was flat-footed.', nextAction: 'Stay on my toes and show the winger the sideline', nextSituation: 'When the ball goes wide to my side', nextMeasure: 'Count how many times I force them outside', northStar: 'Be the defender teammates trust in 1v1s', categories: ['technical'], sourceIds: [prevReflection, prevPub], authorId: DEMO_IDS.max, authorRole: 'athlete', changeReason: 'Chose NEXT after Coach Sam’s feedback', acceptedAt: t(-5), acceptedBy: DEMO_IDS.max, supersededAt: null, createdAt: t(-5), version: 1, declinedAt: null },
    ],
    coachInvites: [],
    coachRelationships: [
      { id: DEMO_IDS.relSam, athleteId: DEMO_IDS.maxAthlete, coachUserId: DEMO_IDS.sam, inviteId: null, verificationState: 'verified', verifiedBy: DEMO_IDS.jordan, verifiedAt: t(-29), verificationEvidenceRef: 'id-review-0007', secondAdultUserId: DEMO_IDS.pat, scope: ['coach_request'], active: true, revokedAt: null, createdAt: t(-30), updatedAt: t(-29), athleteConfirmedAt: t(-30), guardianApprovedAt: t(-30), guardianApprovedBy: DEMO_IDS.pat },
      { id: DEMO_IDS.relKim, athleteId: DEMO_IDS.maxAthlete, coachUserId: DEMO_IDS.kim, inviteId: null, verificationState: 'identity_pending', verifiedBy: null, verifiedAt: null, verificationEvidenceRef: null, secondAdultUserId: DEMO_IDS.pat, scope: ['coach_request'], active: true, revokedAt: null, createdAt: t(-2), updatedAt: t(-2), athleteConfirmedAt: t(-2), guardianApprovedAt: null, guardianApprovedBy: null },
      { id: DEMO_IDS.relLee, athleteId: DEMO_IDS.avaTAthlete, coachUserId: DEMO_IDS.lee, inviteId: null, verificationState: 'verified', verifiedBy: DEMO_IDS.jordan, verifiedAt: t(-3), verificationEvidenceRef: 'id-review-0011', secondAdultUserId: null, scope: ['coach_request'], active: true, revokedAt: null, createdAt: t(-4), updatedAt: t(-3), athleteConfirmedAt: t(-4), guardianApprovedAt: null, guardianApprovedBy: null },
    ],
    loopRequests: [
      { id: prevRequest, athleteId: DEMO_IDS.maxAthlete, reflectionId: prevReflection, sessionId: prevSession, coachRelationshipId: DEMO_IDS.relSam, sharedExcerpt: 'I let the winger turn me because I was flat-footed.', question: 'How do I stop getting turned on the wing?', audience, nextSessionAt: t(-1), dueAt: t(-1), state: 'closed', idempotencyKey: 'fixture-prev-req', createdAt: t(-7, 20), updatedAt: t(-5), version: 4 },
    ],
    drafts: [
      { id: prevDraft, requestId: prevRequest, coachId: DEMO_IDS.sam, summary: 'Good honesty about the moment. Your talk with the centre-back kept the line tidy.', oneNextAction: 'Stay on your toes and show the winger the sideline', situation: 'When the ball goes wide to your side', measure: 'Count how many times you force them outside', aiSourceIds: [], aiModel: null, aiPromptVersion: null, state: 'published', reviewedAudienceHash: audience.hash, reviewedVersion: 3, version: 3, createdAt: t(-6), updatedAt: t(-6) },
    ],
    coachNotes: [
      { id: '81000000-0000-4000-8000-000000000001', coachId: DEMO_IDS.sam, athleteId: null, teamId: DEMO_IDS.team, kind: 'team_transcript', body: 'Synthetic team debrief transcript (coach-only; never shown to athletes or guardians).', createdAt: t(-1) },
    ],
    publications: [
      { id: prevPub, requestId: prevRequest, athleteId: DEMO_IDS.maxAthlete, coachId: DEMO_IDS.sam, draftId: prevDraft, summary: 'Good honesty about the moment. Your talk with the centre-back kept the line tidy.', oneNextAction: 'Stay on your toes and show the winger the sideline', situation: 'When the ball goes wide to your side', measure: 'Count how many times you force them outside', approvedBy: DEMO_IDS.sam, approvedAt: t(-6), audience, correctedFromId: null, isCurrent: true, version: 1, publishIdempotencyKey: 'fixture-prev-pub', createdAt: t(-6) },
    ],
    grants: [],
    briefs: [
      { id: '92000000-0000-4000-8000-000000000001', athleteId: DEMO_IDS.maxAthlete, guardianLinkId: DEMO_IDS.linkPat, authorCoachId: DEMO_IDS.sam, somethingToSay: 'Max has been leading the back line with his voice. That is a real skill.', questionToAsk: 'What did you notice about the wingers today?', habitToPraise: 'Talking to teammates during play', sourceIds: [prevPub], state: 'published', reviewedBy: DEMO_IDS.sam, reviewedAt: t(-5), publishedAt: t(-5), createdAt: t(-5), updatedAt: t(-5) },
    ],
    prefs: users.map((u) => ({ userId: u.id, inAppEnabled: true, emailReminders: false, smsReminders: false as const, quietHoursStart: 21, quietHoursEnd: 8, timezone: u.timezone, updatedAt: t(-30) })),
    notifications: [],
    concerns: [],
    blocks: [],
    audit: [],
    deletionRequests: [],
    sponsorships: [],
    subscriptions: [],
    teams: [{ id: DEMO_IDS.team, tenantId: DEMO_IDS.tenant, clubId: DEMO_IDS.tenant, name: 'U15 Lakers (synthetic)', timezone: 'America/Toronto', createdAt: t(-90) }],
    memberships: [
      { id: '31000000-0000-4000-8000-000000000001', tenantId: DEMO_IDS.tenant, teamId: DEMO_IDS.team, userId: DEMO_IDS.sam, athleteId: null, role: 'coach', startsAt: t(-90), endsAt: null, status: 'active' },
      { id: '31000000-0000-4000-8000-000000000002', tenantId: DEMO_IDS.tenant, teamId: DEMO_IDS.team, userId: DEMO_IDS.max, athleteId: DEMO_IDS.maxAthlete, role: 'athlete', startsAt: t(-90), endsAt: null, status: 'active' },
    ],
    rateHits: {},
    aiCalls: [],
  };
}
