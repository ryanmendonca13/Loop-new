/**
 * Synthetic demo backend. Runs entirely in the browser with fictional data and NO outgoing network
 * effects. It mirrors the server authorization rules (supabase/migrations) using the shared domain
 * policies so the demo behaves honestly — but it is not a security boundary. Production authority is
 * Postgres RLS + SECURITY DEFINER RPCs.
 */
import {
  ACTIVE_REQUEST_STATES,
  DEFAULTS,
  DomainError,
  GATE_MESSAGES,
  INVITE_FAILURE_MESSAGES,
  activationGaps,
  activeGuardianLinksFor,
  assert,
  assertCheckoutAllowed,
  briefHasPressureLanguage,
  briefLeaksDiary,
  buildAudience,
  buildAuditEvent,
  canReadSharedExchange,
  canTransition,
  canWriteDiary,
  checkInviteRedemption,
  coachExchangeGateFailures,
  coachInviteSchema,
  computeEntitlement,
  emailHash,
  feedbackDraftSchema,
  firstIssue,
  focusProposalSchema,
  generateToken,
  guardianInviteSchema,
  hasActiveConsent,
  inviteExpiry,
  isActiveVerifiedCoach,
  isMinorBand,
  loopLabel,
  loopRequestMachine,
  loopRequestSchema,
  maskEmail,
  newId,
  organizeSolo,
  reflectionDraftSchema,
  reflectionSubmitSchema,
  responseDueAt,
  suppressSmallCohorts,
  teamCompletion,
  tokenHash,
  validateAiOutput,
  AI_PROMPT_VERSION,
  parentBriefSchema,
  concernSchema,
} from '../../domain';
import type {
  AccountState,
  Athlete,
  AuditEvent,
  CoachVerificationState,
  ConsentPurpose,
  ConsentRecord,
  EligibilityBand,
  FeedbackDraft,
  FeedbackDraftInput,
  FocusProposalInput,
  LoopRequest,
  LoopRequestInput,
  NotificationPurpose,
  Profile,
  ReflectionDraftInput,
  ReflectionSubmitInput,
  SharingGrant,
  Concern,
  AiSource,
  AudienceMember,
} from '../../domain';
import type {
  AdminView,
  AiSuggestionResult,
  AthleteHome,
  AudiencePreview,
  CoachInbox,
  CoachRequestView,
  CoachSummary,
  CreatedInvite,
  FeedbackView,
  GuardianHome,
  InviteSummary,
  LoopApi,
  PendingStatus,
  SettingsView,
  TeamCoverageCell,
  TimelineItem,
  Viewer,
} from '../../api/types';
import { shortRef } from '../../api/types';
import type { DemoCoachRelationship, DemoState, DemoUser } from './state';
import { buildDemoState } from './fixtures';
import { MOCK_MODEL, mockCoachDraft } from './mockAi';

export const POLICY_VERSION = 'pilot-2026-10';

export interface DemoStorage {
  load(): DemoState | null;
  save(state: DemoState): void;
  clear(): void;
}

export const memoryStorage = (): DemoStorage => {
  let s: DemoState | null = null;
  return { load: () => (s ? structuredClone(s) : null), save: (v) => { s = structuredClone(v); }, clear: () => { s = null; } };
};

export class DemoBackend implements LoopApi {
  readonly kind = 'demo' as const;
  private state: DemoState;
  private actorId: string | null = null;
  private readonly storage: DemoStorage;
  private readonly clock: () => Date;
  /** Captured simulated outbound messages (never sent). */
  readonly outbox: { to: string; subject: string; link: string; at: string }[] = [];

  constructor(opts: { storage?: DemoStorage; clock?: () => Date; actorId?: string | null } = {}) {
    this.storage = opts.storage ?? memoryStorage();
    this.clock = opts.clock ?? (() => new Date());
    const loaded = this.storage.load();
    this.state = loaded && loaded.schemaVersion === 3 ? loaded : buildDemoState(this.clock());
    this.actorId = opts.actorId ?? null;
  }

  // ------------------------------------------------------------------ demo-only controls
  /** DEMO ONLY: role switcher. Never available on the Supabase adapter. */
  setPersona(userId: string | null): void {
    if (userId && !this.state.users.some((u) => u.id === userId)) throw new DomainError('not_found', 'Unknown persona.');
    this.actorId = userId;
  }
  get personaId(): string | null {
    return this.actorId;
  }
  listPersonas(): Pick<DemoUser, 'id' | 'displayName' | 'persona'>[] {
    return this.state.users.map(({ id, displayName, persona }) => ({ id, displayName, persona }));
  }
  reset(): void {
    this.state = buildDemoState(this.clock());
    this.outbox.length = 0;
    this.persist();
  }
  /** DEMO ONLY: inspect the synthetic outbox / raw state in tests. */
  debugState(): DemoState {
    return this.state;
  }

  // ------------------------------------------------------------------ helpers
  private now(): string {
    return this.clock().toISOString();
  }
  private persist(): void {
    this.storage.save(this.state);
  }
  private me(): DemoUser {
    const u = this.state.users.find((x) => x.id === this.actorId);
    if (!u) throw new DomainError('unauthorized', 'Sign in required.');
    return u;
  }
  private user(id: string | null | undefined): DemoUser | undefined {
    return this.state.users.find((u) => u.id === id);
  }
  private name(id: string | null | undefined): string {
    return this.user(id)?.displayName ?? 'Unknown';
  }
  private profileOf(u: DemoUser): Profile {
    return { id: u.id, authUserId: u.id, displayName: u.displayName, locale: 'en', timezone: u.timezone, eligibilityBand: u.band, accountState: u.accountState, createdAt: '', updatedAt: '' };
  }
  private athleteByUser(userId: string): Athlete | undefined {
    return this.state.athletes.find((a) => a.userId === userId);
  }
  private athlete(id: string): Athlete {
    const a = this.state.athletes.find((x) => x.id === id);
    if (!a) throw new DomainError('not_found', 'Athlete not found.');
    return a;
  }
  private athleteUser(athleteId: string): DemoUser {
    const u = this.user(this.athlete(athleteId).userId);
    if (!u) throw new DomainError('not_found', 'Athlete not found.');
    return u;
  }
  private myAthlete(): Athlete | undefined {
    return this.athleteByUser(this.me().id);
  }
  private requireActiveAthlete(): Athlete {
    const me = this.me();
    const a = this.athleteByUser(me.id);
    if (!canWriteDiary(a, this.profileOf(me))) {
      throw new DomainError('account_not_active', 'Your account is not active yet. Diary content can be saved once activation is complete.');
    }
    return a!;
  }
  private isActiveGuardian(athleteId: string, userId = this.actorId): boolean {
    return activeGuardianLinksFor(this.state.guardianLinks, athleteId).some((l) => l.guardianUserId === userId);
  }
  private isVerifiedCoachOf(athleteId: string, userId = this.actorId): boolean {
    return this.state.coachRelationships.some((r) => r.athleteId === athleteId && r.coachUserId === userId && isActiveVerifiedCoach(r));
  }
  private isStaff(role: DemoUser['staffRoles'][number]): boolean {
    // Demo simulates aal2 for staff personas; production requires a real second factor (see migrations).
    return this.me().staffRoles.includes(role);
  }
  private audit(action: string, targetType: string, targetIds: string[], purpose: string, audienceChange: string | null = null, metadata: AuditEvent['metadata'] = {}): void {
    this.state.audit.push(buildAuditEvent({ actorUserId: this.actorId, action, targetType, targetIds, purpose, audienceChange, metadata, now: this.clock() }));
  }
  private notify(recipient: string, purpose: NotificationPurpose, title: string, link: string, key: string, sessionId: string | null = null): void {
    const prefs = this.state.prefs.find((p) => p.userId === recipient);
    if (prefs && !prefs.inAppEnabled) return;
    if (this.state.notifications.some((n) => n.idempotencyKey === key)) return;
    this.state.notifications.push({ id: newId(), recipientUserId: recipient, channel: 'in_app', purpose, consentRecordId: null, dueAt: this.now(), idempotencyKey: key, attemptCount: 1, state: 'sent', title, linkPath: link, providerMessageId: null, lastError: null, readAt: null, relatedSessionId: sessionId, createdAt: this.now() });
  }
  private rateLimit(bucket: string, max: number, windowMs: number): void {
    const k = `${bucket}:${this.actorId}`;
    const cutoff = this.clock().getTime() - windowMs;
    const hits = (this.state.rateHits[k] ?? []).filter((t) => new Date(t).getTime() > cutoff);
    if (hits.length >= max) throw new DomainError('rate_limited', 'Too many attempts. Please wait and try again.');
    hits.push(this.now());
    this.state.rateHits[k] = hits;
  }
  private hasConsent(userId: string, purpose: ConsentPurpose): boolean {
    return hasActiveConsent(this.state.consents, userId, purpose);
  }
  private gapsFor(athleteId: string) {
    const a = this.athlete(athleteId);
    const u = this.athleteUser(athleteId);
    return activationGaps({ band: u.band, consents: this.state.consents, athleteUserId: u.id, guardianLinks: this.state.guardianLinks, athleteId: a.id });
  }
  private tryActivate(athleteId: string): AccountState {
    const a = this.athlete(athleteId);
    const u = this.athleteUser(athleteId);
    if ((a.activationState === 'pending_guardian' || a.activationState === 'withdrawal_pending') && this.gapsFor(athleteId).length === 0) {
      a.activationState = 'active';
      u.accountState = 'active';
      a.updatedAt = this.now();
      this.audit('athlete.activated', 'athlete', [athleteId], 'activation');
    }
    return a.activationState;
  }
  private rel(id: string): DemoCoachRelationship {
    const r = this.state.coachRelationships.find((x) => x.id === id);
    if (!r) throw new DomainError('not_found', 'Coach relationship not found.');
    return r;
  }
  private gateFailures(rel: DemoCoachRelationship) {
    const a = this.athlete(rel.athleteId);
    const u = this.athleteUser(rel.athleteId);
    const out = coachExchangeGateFailures({ athlete: a, profile: this.profileOf(u), relationship: rel, guardianLinks: this.state.guardianLinks, consents: this.state.consents });
    if (this.state.blocks.some((b) => b.blockerUserId === u.id && b.blockedUserId === rel.coachUserId) && !out.includes('coach_not_verified')) out.push('coach_not_verified');
    return out;
  }
  private audienceFor(rel: DemoCoachRelationship) {
    const u = this.athleteUser(rel.athleteId);
    const members: AudienceMember[] = [
      { userId: u.id, displayName: u.displayName, role: 'athlete' as const },
      { userId: rel.coachUserId, displayName: this.name(rel.coachUserId), role: 'coach' as const },
    ];
    if (isMinorBand(u.band) && rel.secondAdultUserId) {
      members.push({ userId: rel.secondAdultUserId, displayName: this.name(rel.secondAdultUserId), role: 'second_adult' as const });
    }
    return buildAudience(members, this.now());
  }
  private cancelActiveRequests(athleteId: string, reason: string, relId?: string): void {
    let n = 0;
    for (const q of this.state.loopRequests) {
      if (q.athleteId === athleteId && ACTIVE_REQUEST_STATES.includes(q.state) && (!relId || q.coachRelationshipId === relId)) {
        q.state = 'canceled';
        q.updatedAt = this.now();
        q.version++;
        n++;
      }
    }
    if (n > 0) this.audit('loop_request.canceled_by_policy', 'athlete', [athleteId], reason, null, { count: n });
  }
  private coachSummary(r: DemoCoachRelationship): CoachSummary {
    return {
      relationshipId: r.id,
      coachUserId: r.coachUserId,
      coachName: this.name(r.coachUserId),
      verificationState: r.verificationState,
      secondAdultName: r.secondAdultUserId ? this.name(r.secondAdultUserId) : null,
      guardianApproved: !!r.guardianApprovedAt,
      active: r.active,
    };
  }
  private inviteState(i: { redeemedAt: string | null; revokedAt: string | null; expiresAt: string }): InviteSummary['state'] {
    if (i.revokedAt) return 'revoked';
    if (i.redeemedAt) return 'redeemed';
    if (i.expiresAt <= this.now()) return 'expired';
    return 'pending';
  }
  private currentFocus(athleteId: string) {
    return this.state.focusVersions.find((f) => f.athleteId === athleteId && f.acceptedAt && !f.supersededAt) ?? null;
  }
  private coachRequestFor(requestId: string): { q: LoopRequest; rel: DemoCoachRelationship } {
    const q = this.state.loopRequests.find((x) => x.id === requestId);
    if (!q) throw new DomainError('not_found', 'Request not found.');
    const rel = this.rel(q.coachRelationshipId);
    if (rel.coachUserId !== this.actorId || !isActiveVerifiedCoach(rel)) throw new DomainError('not_found', 'Request not found.');
    return { q, rel };
  }
  private bumpRequest(q: LoopRequest, to: LoopRequest['state']): void {
    if (!canTransition(loopRequestMachine, q.state, to)) throw new DomainError('invalid_transition', `This request is ${q.state.replaceAll('_', ' ')}.`);
    q.state = to;
    q.updatedAt = this.now();
    q.version++;
  }
  private expireDue(): void {
    for (const q of this.state.loopRequests) {
      if (ACTIVE_REQUEST_STATES.includes(q.state) && q.dueAt <= this.now()) {
        q.state = 'expired';
        q.version++;
      }
    }
  }
  private mutate<T>(fn: () => T): T {
    const snapshot = structuredClone(this.state);
    try {
      const out = fn();
      this.persist();
      return out;
    } catch (e) {
      this.state = snapshot; // transactional: all-or-nothing
      throw e;
    }
  }
  private async mutateAsync<T>(fn: () => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      const out = await fn();
      this.persist();
      return out;
    } catch (e) {
      this.state = snapshot;
      throw e;
    }
  }
  private baseUrl(): string {
    return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  }

  // ------------------------------------------------------------------ viewer
  async getViewer(): Promise<Viewer | null> {
    const u = this.user(this.actorId);
    if (!u) return null;
    const a = this.athleteByUser(u.id);
    return {
      userId: u.id,
      displayName: u.displayName,
      eligibilityBand: u.band,
      accountState: u.accountState,
      athleteId: a?.id ?? null,
      isGuardian: this.state.guardianLinks.some((l) => l.guardianUserId === u.id && ['pending_verification', 'active'].includes(l.status)),
      isCoach: this.state.coachRelationships.some((r) => r.coachUserId === u.id && r.active) || this.state.memberships.some((m) => m.userId === u.id && m.role === 'coach') || u.persona.startsWith('Coach'),
      staffRoles: [...u.staffRoles],
      aal: u.staffRoles.length ? 'aal2' : 'aal1',
    };
  }
  async signOut(): Promise<void> {
    this.actorId = null;
  }

  // ------------------------------------------------------------------ onboarding
  async startAthlete(input: { displayName: string; eligibilityBand: EligibilityBand; timezone: string }): Promise<Viewer> {
    return this.mutate(() => {
      const name = input.displayName.trim();
      assert(name.length > 0 && name.length <= 60, 'validation', 'Display name is required (max 60).');
      const id = newId();
      const state: AccountState = input.eligibilityBand === '18_plus' ? 'active' : 'pending_guardian';
      this.state.users.push({ id, email: `${id.slice(0, 8)}@new.example.test`, displayName: name, band: input.eligibilityBand, accountState: state, timezone: input.timezone || 'UTC', staffRoles: [], persona: 'Athlete you created in this demo' });
      const athleteId = newId();
      this.state.athletes.push({ id: athleteId, userId: id, activationState: 'pending_guardian', sportPreference: null, createdAt: this.now(), updatedAt: this.now() });
      this.state.consents.push({ id: newId(), subjectUserId: id, actorUserId: id, purpose: 'privacy_notice', policyVersion: POLICY_VERSION, scope: [], grantedAt: this.now(), withdrawnAt: null, provenance: 'demo_signup' });
      this.state.prefs.push({ userId: id, inAppEnabled: true, emailReminders: false, smsReminders: false, quietHoursStart: DEFAULTS.quietHoursStart, quietHoursEnd: DEFAULTS.quietHoursEnd, timezone: input.timezone || 'UTC', updatedAt: this.now() });
      this.actorId = id;
      this.tryActivate(athleteId);
      this.audit('profile.registered', 'profile', [id], 'onboarding', null, { band: input.eligibilityBand });
      const a = this.athleteByUser(id)!;
      return { userId: id, displayName: name, eligibilityBand: input.eligibilityBand, accountState: a.activationState, athleteId, isGuardian: false, isCoach: false, staffRoles: [], aal: 'aal1' };
    });
  }

  async getPendingStatus(): Promise<PendingStatus> {
    const me = this.me();
    const a = this.athleteByUser(me.id);
    if (!a) throw new DomainError('forbidden', 'Not an athlete account.');
    return {
      displayName: me.displayName,
      gaps: this.gapsFor(a.id),
      invites: this.state.guardianInvites
        .filter((i) => i.athleteId === a.id)
        .map((i) => ({ id: i.id, label: 'Guardian', hint: i.intendedEmailHint, expiresAt: i.expiresAt, state: this.inviteState(i) })),
      linkStates: this.state.guardianLinks.filter((l) => l.athleteId === a.id).map((l) => ({ id: l.id, status: l.status, guardianName: l.guardianUserId ? this.name(l.guardianUserId) : null })),
    };
  }

  async createGuardianInvite(email: string): Promise<CreatedInvite> {
    const parsed = guardianInviteSchema.safeParse({ guardianEmail: email });
    if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
    const token = generateToken();
    const [eh, th] = await Promise.all([emailHash(parsed.data.guardianEmail), tokenHash(token)]);
    return this.mutate(() => {
      const a = this.myAthlete();
      if (!a) throw new DomainError('forbidden', 'Only athletes can invite a guardian.');
      this.rateLimit('guardian_invite', 5, 86_400_000);
      const id = newId();
      const expiresAt = inviteExpiry(this.clock(), DEFAULTS.guardianInviteExpiryDays);
      this.state.guardianInvites.push({ id, athleteId: a.id, intendedEmailHash: eh, intendedEmailHint: maskEmail(parsed.data.guardianEmail), tokenHash: th, expiresAt, redeemedAt: null, redeemedBy: null, revokedAt: null, createdBy: this.me().id, createdAt: this.now() });
      this.audit('guardian_invite.created', 'guardian_invite', [id, a.id], 'guardian_activation');
      const link = `${this.baseUrl()}/guardian/accept#token=${token}`;
      this.outbox.push({ to: maskEmail(parsed.data.guardianEmail), subject: 'You have been invited to support an athlete on Loop', link, at: this.now() });
      return { inviteId: id, link, expiresAt, delivery: 'simulated_copy_link' as const };
    });
  }

  async cancelGuardianInvite(inviteId: string): Promise<void> {
    this.mutate(() => {
      const a = this.myAthlete();
      const inv = this.state.guardianInvites.find((i) => i.id === inviteId && i.athleteId === a?.id && !i.redeemedAt && !i.revokedAt);
      if (!inv) throw new DomainError('not_found', 'Invite not found.');
      inv.revokedAt = this.now();
      this.audit('guardian_invite.revoked', 'guardian_invite', [inviteId], 'guardian_activation');
    });
  }

  async recordConsent(purpose: ConsentPurpose, athleteId?: string): Promise<{ accountState: AccountState | null }> {
    return this.mutate(() => {
      const me = this.me();
      let subject = me.id;
      let targetAthlete: string | undefined;
      if (purpose === 'guardian_consent') {
        if (!athleteId || !this.isActiveGuardian(athleteId)) throw new DomainError('forbidden', 'Only a verified linked guardian can give guardian consent.');
        subject = this.athlete(athleteId).userId;
        targetAthlete = athleteId;
      } else if (purpose === 'sms_notifications') {
        throw new DomainError('feature_disabled', 'SMS is not available.');
      } else {
        targetAthlete = this.myAthlete()?.id;
        if (purpose === 'athlete_assent' && !targetAthlete) throw new DomainError('forbidden', 'Assent is for athletes.');
      }
      if (!this.hasConsent(subject, purpose)) {
        const id = newId();
        this.state.consents.push({ id, subjectUserId: subject, actorUserId: me.id, purpose, policyVersion: POLICY_VERSION, scope: [], grantedAt: this.now(), withdrawnAt: null, provenance: `in_app:${purpose}` });
        this.audit('consent.granted', 'consent', [id], purpose, null, { policy_version: POLICY_VERSION });
      }
      return { accountState: targetAthlete ? this.tryActivate(targetAthlete) : null };
    });
  }

  async withdrawConsent(consentId: string): Promise<void> {
    this.mutate(() => {
      const me = this.me();
      const c = this.state.consents.find((x) => x.id === consentId && !x.withdrawnAt && (x.subjectUserId === me.id || x.actorUserId === me.id));
      if (!c) throw new DomainError('not_found', 'Consent not found.');
      c.withdrawnAt = this.now();
      const a = this.athleteByUser(c.subjectUserId);
      if (a && ['guardian_consent', 'athlete_assent', 'privacy_notice'].includes(c.purpose)) {
        if (a.activationState === 'active') {
          a.activationState = 'withdrawal_pending';
          this.athleteUser(a.id).accountState = 'withdrawal_pending';
        }
        this.cancelActiveRequests(a.id, 'consent_withdrawn');
        for (const b of this.state.briefs) if (b.athleteId === a.id && b.state === 'published') b.state = 'revoked';
      } else if (a && c.purpose === 'coach_sharing') {
        this.cancelActiveRequests(a.id, 'coach_sharing_withdrawn');
      } else if (c.purpose === 'voice_recording') {
        for (const v of this.state.voiceAssets) if (v.ownerUserId === c.subjectUserId && v.retentionState === 'active') v.retentionState = 'delete_pending';
      } else if (c.purpose === 'email_notifications') {
        const p = this.state.prefs.find((x) => x.userId === c.subjectUserId);
        if (p) p.emailReminders = false;
      }
      this.audit('consent.withdrawn', 'consent', [consentId], c.purpose);
    });
  }

  // ------------------------------------------------------------------ athlete
  async getAthleteHome(): Promise<AthleteHome> {
    this.expireDue();
    const me = this.me();
    const a = this.myAthlete();
    if (!a) throw new DomainError('forbidden', 'Not an athlete account.');
    const now = this.now();
    const sessions = this.state.sessions.filter((s) => s.athleteId === a.id && s.state === 'scheduled' && s.startsAt > now).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
    const openAssignment = this.state.assignments
      .filter((x) => x.athleteId === a.id && ['open', 'draft'].includes(x.state))
      .sort((x, y) => (x.dueAt ?? '').localeCompare(y.dueAt ?? ''))[0];
    const requests = this.state.loopRequests.filter((q) => q.athleteId === a.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const latest = requests[0];
    return {
      displayName: me.displayName,
      athleteId: a.id,
      eligibilityBand: me.band,
      nextSession: sessions[0] ?? null,
      openAssignmentId: openAssignment?.id ?? null,
      currentFocus: this.currentFocus(a.id),
      focusProposals: this.state.focusVersions
        .filter((f) => f.athleteId === a.id && !f.acceptedAt && !f.declinedAt)
        .map((f) => ({ ...f, authorName: this.name(f.authorId) })),
      latestRequest: latest ? { request: latest, label: loopLabel(latest), coachName: this.name(this.rel(latest.coachRelationshipId).coachUserId) } : null,
      coaches: this.state.coachRelationships.filter((r) => r.athleteId === a.id && r.active).map((r) => this.coachSummary(r)),
      recentReflections: this.state.reflections.filter((r) => r.athleteId === a.id && r.state === 'submitted').sort((x, y) => (y.submittedAt ?? '').localeCompare(x.submittedAt ?? '')).slice(0, 3),
    };
  }

  async createSession(input: { title: string; sport: string | null; startsAt: string; nextSessionAt: string | null }) {
    return this.mutate(() => {
      const a = this.requireActiveAthlete();
      assert(input.title.trim().length > 0 && input.title.length <= 120, 'validation', 'Title is required.');
      const sessionId = newId();
      const due = new Date(new Date(input.startsAt).getTime() + 86_400_000).toISOString();
      this.state.sessions.push({ id: sessionId, athleteId: a.id, teamId: null, tenantId: null, title: input.title.trim(), sport: input.sport, startsAt: input.startsAt, timezone: this.me().timezone, state: 'scheduled', reflectionDueAt: due, nextSessionAt: input.nextSessionAt, createdAt: this.now(), updatedAt: this.now(), authorId: this.me().id, version: 1 });
      const assignmentId = newId();
      this.state.assignments.push({ id: assignmentId, athleteId: a.id, sessionId, promptVersionId: this.state.promptVersions[0]!.id, dueAt: due, expected: true, state: input.startsAt <= this.now() ? 'open' : 'upcoming', createdAt: this.now(), updatedAt: this.now() });
      return { sessionId, assignmentId };
    });
  }

  async cancelSession(sessionId: string): Promise<void> {
    this.mutate(() => {
      const a = this.myAthlete();
      const s = this.state.sessions.find((x) => x.id === sessionId && x.athleteId === a?.id);
      if (!s) throw new DomainError('not_found', 'Session not found.');
      if (s.state !== 'scheduled') throw new DomainError('invalid_transition', 'Only scheduled sessions can be canceled.');
      s.state = 'canceled';
      s.version++;
      for (const x of this.state.assignments) if (x.sessionId === sessionId && ['upcoming', 'open', 'draft'].includes(x.state)) x.state = 'canceled';
      for (const n of this.state.notifications) if (n.relatedSessionId === sessionId && n.state === 'pending') n.state = 'canceled';
      this.audit('session.canceled', 'activity_session', [sessionId], 'schedule_change');
    });
  }

  async getDraft(assignmentId: string | null) {
    const a = this.requireActiveAthlete();
    return this.state.reflections.find((r) => r.athleteId === a.id && r.state === 'draft' && r.assignmentId === assignmentId) ?? null;
  }

  async saveDraft(input: ReflectionDraftInput & { reflectionId: string | null; assignmentId: string | null; expectedVersion: number | null }) {
    return this.mutate(() => {
      const a = this.requireActiveAthlete();
      const parsed = reflectionDraftSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      const v = parsed.data;
      if (input.assignmentId && !this.state.assignments.some((x) => x.id === input.assignmentId && x.athleteId === a.id)) throw new DomainError('not_found', 'Assignment not found.');
      if (!input.reflectionId) {
        const id = newId();
        this.state.reflections.push({ id, athleteId: a.id, assignmentId: input.assignmentId, promptVersionId: this.state.promptVersions[0]!.id, answerWell: v.answerWell, answerMomentBack: v.answerMomentBack, supportRequest: v.supportRequest || null, mood: v.mood, state: 'draft', submittedAt: null, version: 1, revisionOf: null, idempotencyKey: null, createdAt: this.now(), updatedAt: this.now(), authorId: this.me().id });
        const asg = this.state.assignments.find((x) => x.id === input.assignmentId);
        if (asg && ['upcoming', 'open'].includes(asg.state)) asg.state = 'draft';
        return { reflectionId: id, version: 1 };
      }
      const r = this.state.reflections.find((x) => x.id === input.reflectionId && x.athleteId === a.id);
      if (!r) throw new DomainError('not_found', 'Reflection not found.');
      if (r.state !== 'draft') throw new DomainError('invalid_transition', 'Submitted reflections are edited by creating a revision.');
      if (input.expectedVersion !== null && r.version !== input.expectedVersion) throw new DomainError('conflict', 'This draft was changed elsewhere. Reload to continue.');
      Object.assign(r, { answerWell: v.answerWell, answerMomentBack: v.answerMomentBack, supportRequest: v.supportRequest || null, mood: v.mood, updatedAt: this.now(), version: r.version + 1 });
      return { reflectionId: r.id, version: r.version };
    });
  }

  async submitReflection(input: ReflectionSubmitInput & { reflectionId: string | null; assignmentId: string | null }) {
    return this.mutate(() => {
      const a = this.requireActiveAthlete();
      const existing = this.state.reflections.find((r) => r.athleteId === a.id && r.idempotencyKey === input.idempotencyKey);
      if (existing) return { reflectionId: existing.id, duplicate: true };
      const parsed = reflectionSubmitSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      const v = parsed.data;
      let r = input.reflectionId ? this.state.reflections.find((x) => x.id === input.reflectionId && x.athleteId === a.id && x.state === 'draft') : undefined;
      if (input.reflectionId && !r) throw new DomainError('not_found', 'Draft not found.');
      if (!r) {
        r = { id: newId(), athleteId: a.id, assignmentId: input.assignmentId, promptVersionId: this.state.promptVersions[0]!.id, answerWell: '', answerMomentBack: '', supportRequest: null, mood: null, state: 'draft', submittedAt: null, version: 0, revisionOf: null, idempotencyKey: null, createdAt: this.now(), updatedAt: this.now(), authorId: this.me().id };
        this.state.reflections.push(r);
      }
      Object.assign(r, { answerWell: v.answerWell, answerMomentBack: v.answerMomentBack, supportRequest: v.supportRequest || null, mood: v.mood, state: 'submitted', submittedAt: this.now(), idempotencyKey: v.idempotencyKey, version: r.version + 1, updatedAt: this.now() });
      const asg = this.state.assignments.find((x) => x.id === r!.assignmentId);
      if (asg && ['upcoming', 'open', 'draft'].includes(asg.state)) asg.state = 'submitted';
      this.audit('reflection.submitted', 'reflection', [r.id], 'diary');
      return { reflectionId: r.id, duplicate: false };
    });
  }

  async getReflection(id: string) {
    const a = this.myAthlete();
    const r = this.state.reflections.find((x) => x.id === id && x.athleteId === a?.id);
    if (!r) throw new DomainError('not_found', 'Reflection not found.');
    return r;
  }

  async organizeSolo(reflectionId: string) {
    const r = await this.getReflection(reflectionId);
    return organizeSolo(r, this.currentFocus(r.athleteId));
  }

  async proposeFocus(input: FocusProposalInput & { athleteId: string; accept: boolean }) {
    return this.mutate(() => {
      const me = this.me();
      const parsed = focusProposalSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      const own = this.athleteByUser(me.id)?.id === input.athleteId;
      let role: 'athlete' | 'coach';
      if (own) {
        this.requireActiveAthlete();
        role = 'athlete';
      } else if (this.isVerifiedCoachOf(input.athleteId)) role = 'coach';
      else throw new DomainError('forbidden', 'Not allowed to propose a focus for this athlete.');
      const v = parsed.data;
      const id = newId();
      this.state.focusVersions.push({ id, focusPlanId: input.athleteId, athleteId: input.athleteId, now: v.now, nextAction: v.nextAction, nextSituation: v.nextSituation, nextMeasure: v.nextMeasure, northStar: v.northStar || null, categories: v.categories, sourceIds: v.sourceIds, authorId: me.id, authorRole: role, changeReason: v.changeReason, acceptedAt: null, acceptedBy: null, supersededAt: null, createdAt: this.now(), version: 1, declinedAt: null });
      this.audit('focus.proposed', 'focus_version', [id, input.athleteId], 'focus', null, { author_role: role });
      const accepted = input.accept && role === 'athlete';
      if (accepted) this.acceptFocusInternal(id);
      if (role === 'coach') this.notify(this.athlete(input.athleteId).userId, 'system', 'Your coach suggested a focus update', '/home', `focus:${id}`);
      return { focusVersionId: id, accepted };
    });
  }

  private acceptFocusInternal(id: string): void {
    const a = this.requireActiveAthlete();
    const f = this.state.focusVersions.find((x) => x.id === id && x.athleteId === a.id);
    if (!f) throw new DomainError('not_found', 'Focus version not found.');
    if (f.acceptedAt || f.declinedAt) throw new DomainError('invalid_transition', 'Already decided.');
    for (const c of this.state.focusVersions) if (c.athleteId === a.id && c.acceptedAt && !c.supersededAt) c.supersededAt = this.now();
    f.acceptedAt = this.now();
    f.acceptedBy = this.me().id;
    this.audit('focus.accepted', 'focus_version', [id, a.id], 'focus');
  }
  async acceptFocus(id: string) {
    this.mutate(() => this.acceptFocusInternal(id));
  }
  async declineFocus(id: string) {
    this.mutate(() => {
      const a = this.requireActiveAthlete();
      const f = this.state.focusVersions.find((x) => x.id === id && x.athleteId === a.id && !x.acceptedAt && !x.declinedAt);
      if (!f) throw new DomainError('not_found', 'Focus version not found.');
      f.declinedAt = this.now();
      this.audit('focus.declined', 'focus_version', [id, a.id], 'focus');
    });
  }

  async getTimeline(): Promise<TimelineItem[]> {
    const a = this.myAthlete();
    if (!a) throw new DomainError('forbidden', 'Not an athlete account.');
    const items: TimelineItem[] = [];
    for (const r of this.state.reflections) if (r.athleteId === a.id && r.state === 'submitted') items.push({ kind: 'reflection', at: r.submittedAt!, source: 'athlete_words', reflection: r });
    for (const p of this.state.publications) if (p.athleteId === a.id) items.push({ kind: 'feedback', at: p.approvedAt, source: 'coach_observation', publication: p, coachName: this.name(p.coachId) });
    for (const f of this.state.focusVersions) if (f.athleteId === a.id && f.acceptedAt) items.push({ kind: 'focus', at: f.acceptedAt, source: f.authorRole === 'athlete' ? 'athlete_words' : 'coach_observation', focus: f, authorName: this.name(f.authorId) });
    for (const q of this.state.loopRequests) if (q.athleteId === a.id) items.push({ kind: 'request', at: q.createdAt, source: 'athlete_words', request: q, label: loopLabel(q), coachName: this.name(this.rel(q.coachRelationshipId).coachUserId) });
    return items.sort((x, y) => y.at.localeCompare(x.at));
  }

  async listCoaches() {
    const a = this.myAthlete();
    if (!a) throw new DomainError('forbidden', 'Not an athlete account.');
    return {
      coaches: this.state.coachRelationships.filter((r) => r.athleteId === a.id && r.active).map((r) => this.coachSummary(r)),
      invites: this.state.coachInvites.filter((i) => i.athleteId === a.id).map((i) => ({ id: i.id, label: i.coachDisplayName, hint: i.intendedEmailHint, expiresAt: i.expiresAt, state: this.inviteState(i) })),
    };
  }

  async createCoachInvite(input: { coachDisplayName: string; coachEmail: string }): Promise<CreatedInvite> {
    const parsed = coachInviteSchema.safeParse(input);
    if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
    const token = generateToken();
    const [eh, th] = await Promise.all([emailHash(parsed.data.coachEmail), tokenHash(token)]);
    return this.mutate(() => {
      const a = this.requireActiveAthlete();
      this.rateLimit('coach_invite', 5, 86_400_000);
      const id = newId();
      const expiresAt = inviteExpiry(this.clock());
      this.state.coachInvites.push({ id, athleteId: a.id, coachDisplayName: parsed.data.coachDisplayName, intendedEmailHash: eh, intendedEmailHint: maskEmail(parsed.data.coachEmail), tokenHash: th, expiresAt, redeemedAt: null, redeemedBy: null, revokedAt: null, createdBy: this.me().id, createdAt: this.now() });
      this.audit('coach_invite.created', 'coach_invite', [id, a.id], 'coach_invitation');
      // Token in the URL fragment: not sent to servers or logs. The link carries no diary data.
      const link = `${this.baseUrl()}/coach/accept#token=${token}`;
      this.outbox.push({ to: maskEmail(parsed.data.coachEmail), subject: 'An athlete has invited you to Loop', link, at: this.now() });
      return { inviteId: id, link, expiresAt, delivery: 'simulated_copy_link' as const };
    });
  }

  async revokeCoachInvite(inviteId: string) {
    this.mutate(() => {
      const a = this.myAthlete();
      const i = this.state.coachInvites.find((x) => x.id === inviteId && x.athleteId === a?.id && !x.redeemedAt && !x.revokedAt);
      if (!i) throw new DomainError('not_found', 'Invite not found.');
      i.revokedAt = this.now();
      this.audit('coach_invite.revoked', 'coach_invite', [inviteId], 'coach_invitation');
    });
  }

  async revokeCoach(relationshipId: string) {
    this.mutate(() => this.revokeCoachInternal(relationshipId));
  }
  private revokeCoachInternal(relationshipId: string) {
    const r = this.rel(relationshipId);
    const own = this.myAthlete()?.id === r.athleteId;
    if (!own && !this.isActiveGuardian(r.athleteId)) throw new DomainError('not_found', 'Relationship not found.');
    r.active = false;
    r.revokedAt = this.now();
    for (const g of this.state.grants) if (g.relationshipId === relationshipId && !g.revokedAt) g.revokedAt = this.now();
    this.cancelActiveRequests(r.athleteId, 'coach_revoked', relationshipId);
    this.audit('coach_relationship.revoked', 'coach_relationship', [relationshipId, r.athleteId], 'access_change', 'coach_removed');
  }

  async previewAudience(relationshipId: string): Promise<AudiencePreview> {
    const r = this.rel(relationshipId);
    const own = this.myAthlete()?.id === r.athleteId;
    const coach = r.coachUserId === this.actorId && isActiveVerifiedCoach(r);
    if (!own && !coach) throw new DomainError('not_found', 'Relationship not found.');
    const aud = this.audienceFor(r);
    return { members: aud.members, hash: aud.hash, gateFailures: this.gateFailures(r) };
  }

  async createLoopRequest(input: LoopRequestInput) {
    return this.mutate(() => {
      const a = this.requireActiveAthlete();
      const dup = this.state.loopRequests.find((q) => q.athleteId === a.id && q.idempotencyKey === input.idempotencyKey);
      if (dup) return { requestId: dup.id, duplicate: true };
      const parsed = loopRequestSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      const v = parsed.data;
      const rel = this.state.coachRelationships.find((r) => r.id === v.coachRelationshipId && r.athleteId === a.id);
      if (!rel) throw new DomainError('not_found', 'Coach not found.');
      const gates = this.gateFailures(rel);
      if (gates.length) {
        const code = gates.some((g) => g.startsWith('second_adult')) ? 'second_adult_required' : gates.includes('coach_not_verified') ? 'coach_not_verified' : 'forbidden';
        throw new DomainError(code, GATE_MESSAGES[gates[0]!]);
      }
      const reflection = this.state.reflections.find((r) => r.id === v.reflectionId && r.athleteId === a.id && r.state === 'submitted');
      if (!reflection) throw new DomainError('not_found', 'Submit the reflection before sharing it.');
      const aud = this.audienceFor(rel);
      if (aud.hash !== v.confirmedAudienceHash) throw new DomainError('stale_review', 'Who can see this request has changed. Review the audience again.');
      // Mirrors the DB partial unique index: one active request per athlete, across all coaches.
      if (this.state.loopRequests.some((q) => q.athleteId === a.id && ACTIVE_REQUEST_STATES.includes(q.state))) {
        throw new DomainError('active_request_exists', 'You already have an open coach request. Wait for it, or cancel it first.');
      }
      const asg = this.state.assignments.find((x) => x.id === reflection.assignmentId);
      const session = this.state.sessions.find((s) => s.id === asg?.sessionId);
      const next = session?.nextSessionAt ?? null;
      const q: LoopRequest = { id: newId(), athleteId: a.id, reflectionId: reflection.id, sessionId: session?.id ?? null, coachRelationshipId: rel.id, sharedExcerpt: v.sharedExcerpt, question: v.question, audience: aud, nextSessionAt: next, dueAt: responseDueAt(next, this.clock()), state: 'queued', idempotencyKey: v.idempotencyKey, createdAt: this.now(), updatedAt: this.now(), version: 1 };
      this.state.loopRequests.push(q);
      this.bumpRequest(q, 'waiting_for_coach');
      this.notify(rel.coachUserId, 'coach_request_waiting', 'An athlete is waiting for your feedback', '/coach', `req-waiting:${q.id}`);
      this.audit('loop_request.created', 'loop_request', [q.id, a.id], 'coach_exchange', 'shared_with_audience', { audience_hash: aud.hash });
      return { requestId: q.id, duplicate: false };
    });
  }

  async cancelLoopRequest(requestId: string) {
    this.mutate(() => {
      const a = this.myAthlete();
      const q = this.state.loopRequests.find((x) => x.id === requestId && x.athleteId === a?.id);
      if (!q || !ACTIVE_REQUEST_STATES.includes(q.state)) throw new DomainError('invalid_transition', 'Only open requests can be canceled.');
      this.bumpRequest(q, 'canceled');
      this.audit('loop_request.canceled', 'loop_request', [requestId], 'coach_exchange');
    });
  }

  async getFeedback(requestId: string): Promise<FeedbackView> {
    this.expireDue();
    const a = this.myAthlete();
    const q = this.state.loopRequests.find((x) => x.id === requestId && x.athleteId === a?.id);
    if (!q) throw new DomainError('not_found', 'Request not found.');
    const rel = this.rel(q.coachRelationshipId);
    const pubs = this.state.publications.filter((p) => p.requestId === q.id).sort((x, y) => x.version - y.version);
    return { request: q, label: loopLabel(q), coachName: this.name(rel.coachUserId), coachVerified: isActiveVerifiedCoach(rel), publication: pubs.find((p) => p.isCurrent) ?? null, history: pubs, currentFocus: this.currentFocus(q.athleteId) };
  }

  async acknowledgeFeedback(requestId: string, close: boolean) {
    this.mutate(() => {
      const a = this.requireActiveAthlete();
      const q = this.state.loopRequests.find((x) => x.id === requestId && x.athleteId === a.id);
      if (!q) throw new DomainError('not_found', 'Request not found.');
      if (q.state === 'published') this.bumpRequest(q, close ? 'closed' : 'athlete_acknowledged');
      else if (q.state === 'athlete_acknowledged' && close) this.bumpRequest(q, 'closed');
      else throw new DomainError('invalid_transition', 'Only published feedback can be acknowledged.');
      this.audit('loop_request.acknowledged', 'loop_request', [requestId], 'coach_exchange');
    });
  }

  async grantShare(input: { recordType: SharingGrant['recordType']; recordId: string; recipientUserId: string; surface: SharingGrant['surface']; purpose: string }) {
    this.mutate(() => {
      const a = this.requireActiveAthlete();
      if (input.recordType === 'reflection' && !this.state.reflections.some((r) => r.id === input.recordId && r.athleteId === a.id && r.state === 'submitted')) throw new DomainError('not_found', 'Record not found.');
      let relId: string | null = null;
      if (input.surface === 'coach_history' || input.surface === 'coach_request') {
        const rel = this.state.coachRelationships.find((r) => r.athleteId === a.id && r.coachUserId === input.recipientUserId && isActiveVerifiedCoach(r));
        if (!rel) throw new DomainError('coach_not_verified', 'Only a verified coach can receive shared records.');
        relId = rel.id;
      } else if (input.surface === 'guardian_cues') {
        if (!this.isActiveGuardian(a.id, input.recipientUserId)) throw new DomainError('forbidden', 'Only an active linked guardian.');
      } else throw new DomainError('validation', 'Unknown surface.');
      if (this.state.grants.some((g) => g.recordId === input.recordId && g.recipientUserId === input.recipientUserId && g.surface === input.surface && !g.revokedAt)) return;
      const id = newId();
      this.state.grants.push({ id, recordType: input.recordType, recordId: input.recordId, ownerAthleteId: a.id, recipientUserId: input.recipientUserId, relationshipId: relId, surface: input.surface, purpose: input.purpose, grantedAt: this.now(), revokedAt: null });
      this.audit('share.granted', input.recordType, [input.recordId, a.id], input.purpose, `grant:${input.surface}`);
    });
  }

  async revokeShare(grantId: string) {
    this.mutate(() => {
      const a = this.myAthlete();
      const g = this.state.grants.find((x) => x.id === grantId && x.ownerAthleteId === a?.id && !x.revokedAt);
      if (!g) throw new DomainError('not_found', 'Grant not found.');
      g.revokedAt = this.now();
      this.audit('share.revoked', g.recordType, [g.recordId, g.ownerAthleteId], g.purpose, `revoke:${g.surface}`);
    });
  }

  async simulateVoiceTranscript() {
    const me = this.me();
    this.requireActiveAthlete();
    if (!this.hasConsent(me.id, 'voice_recording')) throw new DomainError('consent_required', 'Voice recording needs separate consent.');
    return { transcript: 'SIMULATED TRANSCRIPT — edit before saving: I stayed patient on the ball and found the pass.', simulated: true as const };
  }

  // ------------------------------------------------------------------ guardian
  async redeemGuardianInvite(token: string) {
    const me = this.me();
    const th = await tokenHash(token);
    const inv = this.state.guardianInvites.find((i) => i.tokenHash === th);
    const failure = await checkInviteRedemption(inv ? { ...inv, coachDisplayName: '' } : undefined, token, me.email, this.clock());
    return this.mutate(() => {
      this.rateLimit('invite_redeem', 10, 3_600_000);
      if (failure) throw new DomainError('invite_invalid', INVITE_FAILURE_MESSAGES[failure]);
      if (me.band !== '18_plus') throw new DomainError('forbidden', 'A guardian must have an adult profile.');
      if (this.athlete(inv!.athleteId).userId === me.id) throw new DomainError('forbidden', 'You cannot be your own guardian.');
      inv!.redeemedAt = this.now();
      inv!.redeemedBy = me.id;
      const id = newId();
      this.state.guardianLinks.push({ id, guardianUserId: me.id, athleteId: inv!.athleteId, inviteContactHint: inv!.intendedEmailHint, status: 'pending_verification', verifiedBy: null, verifiedAt: null, verificationEvidenceRef: null, consentScope: [], revokedAt: null, createdAt: this.now(), updatedAt: this.now() });
      this.audit('guardian_link.pending', 'guardian_link', [id, inv!.athleteId], 'guardian_activation');
      return { linkId: id, status: 'pending_verification' };
    });
  }

  async getGuardianHome(): Promise<GuardianHome> {
    this.expireDue();
    const me = this.me();
    const links = this.state.guardianLinks.filter((l) => l.guardianUserId === me.id && ['pending_verification', 'active'].includes(l.status));
    return {
      displayName: me.displayName,
      children: links.map((l) => {
        const u = this.athleteUser(l.athleteId);
        const active = l.status === 'active';
        const rels = this.state.coachRelationships.filter((r) => r.athleteId === l.athleteId && r.active);
        const threads = active
          ? this.state.loopRequests
              .filter((q) => q.athleteId === l.athleteId)
              .filter((q) => canReadSharedExchange({ viewerUserId: me.id, request: q, athleteUserId: u.id, relationship: this.rel(q.coachRelationshipId), guardianLinks: this.state.guardianLinks }) === 'second_adult')
              .sort((x, y) => y.createdAt.localeCompare(x.createdAt))
              .map((q) => ({ request: q, publication: this.state.publications.find((p) => p.requestId === q.id && p.isCurrent) ?? null, coachName: this.name(this.rel(q.coachRelationshipId).coachUserId), label: loopLabel(q) }))
          : [];
        return {
          athleteId: l.athleteId,
          displayName: u.displayName,
          accountState: u.accountState,
          linkId: l.id,
          linkStatus: l.status,
          guardianConsentGiven: this.state.consents.some((c) => c.subjectUserId === u.id && c.purpose === 'guardian_consent' && !c.withdrawnAt),
          gaps: this.gapsFor(l.athleteId),
          focus: active ? this.currentFocus(l.athleteId) : null,
          sharedThreads: threads,
          briefs: active ? this.state.briefs.filter((b) => b.guardianLinkId === l.id && b.state === 'published') : [],
          coachesAwaitingApproval: active ? rels.filter((r) => !r.guardianApprovedAt && ['invited', 'identity_pending'].includes(r.verificationState)).map((r) => this.coachSummary(r)) : [],
          coaches: active ? rels.map((r) => this.coachSummary(r)) : [],
        };
      }),
    };
  }

  async approveCoach(relationshipId: string) {
    this.mutate(() => {
      const r = this.rel(relationshipId);
      if (!this.isActiveGuardian(r.athleteId)) throw new DomainError('forbidden', 'Not a linked guardian.');
      r.guardianApprovedAt = this.now();
      r.guardianApprovedBy = this.actorId;
      r.secondAdultUserId = r.secondAdultUserId ?? this.actorId;
      this.audit('coach_relationship.guardian_approved', 'coach_relationship', [relationshipId, r.athleteId], 'coach_verification');
    });
  }

  async revokeGuardianLink(linkId: string) {
    this.mutate(() => {
      const me = this.me();
      const l = this.state.guardianLinks.find((x) => x.id === linkId);
      if (!l || !(l.guardianUserId === me.id || this.myAthlete()?.id === l.athleteId)) throw new DomainError('not_found', 'Link not found.');
      if (['revoked', 'rejected'].includes(l.status)) return;
      l.status = 'revoked';
      l.revokedAt = this.now();
      for (const b of this.state.briefs) if (b.guardianLinkId === linkId) b.state = 'revoked';
      for (const g of this.state.grants) if (g.ownerAthleteId === l.athleteId && g.recipientUserId === l.guardianUserId && !g.revokedAt) g.revokedAt = this.now();
      for (const r of this.state.coachRelationships) {
        if (r.athleteId === l.athleteId && r.secondAdultUserId === l.guardianUserId) {
          this.cancelActiveRequests(l.athleteId, 'second_adult_removed', r.id);
          r.secondAdultUserId = null;
        }
      }
      const u = this.athleteUser(l.athleteId);
      if (isMinorBand(u.band) && activeGuardianLinksFor(this.state.guardianLinks, l.athleteId).length === 0) {
        const a = this.athlete(l.athleteId);
        if (a.activationState === 'active') {
          a.activationState = 'withdrawal_pending';
          u.accountState = 'withdrawal_pending';
        }
      }
      this.audit('guardian_link.revoked', 'guardian_link', [linkId, l.athleteId], 'withdrawal', 'guardian_removed');
    });
  }

  // ------------------------------------------------------------------ coach
  async redeemCoachInvite(token: string) {
    const me = this.me();
    const th = await tokenHash(token);
    const inv = this.state.coachInvites.find((i) => i.tokenHash === th);
    const failure = await checkInviteRedemption(inv, token, me.email, this.clock());
    return this.mutate(() => {
      this.rateLimit('invite_redeem', 10, 3_600_000);
      if (failure) throw new DomainError('invite_invalid', INVITE_FAILURE_MESSAGES[failure]);
      if (me.band !== '18_plus' || me.accountState !== 'active') throw new DomainError('forbidden', 'Coaches need an active adult profile.');
      if (this.athlete(inv!.athleteId).userId === me.id) throw new DomainError('forbidden', 'You cannot coach yourself.');
      inv!.redeemedAt = this.now();
      inv!.redeemedBy = me.id;
      const minor = isMinorBand(this.athleteUser(inv!.athleteId).band);
      const second = minor ? activeGuardianLinksFor(this.state.guardianLinks, inv!.athleteId)[0]?.guardianUserId ?? null : null;
      let rel = this.state.coachRelationships.find((r) => r.athleteId === inv!.athleteId && r.coachUserId === me.id && r.active);
      if (!rel) {
        rel = { id: newId(), athleteId: inv!.athleteId, coachUserId: me.id, inviteId: inv!.id, verificationState: 'identity_pending', verifiedBy: null, verifiedAt: null, verificationEvidenceRef: null, secondAdultUserId: second, scope: ['coach_request'], active: true, revokedAt: null, createdAt: this.now(), updatedAt: this.now(), athleteConfirmedAt: inv!.createdAt, guardianApprovedAt: null, guardianApprovedBy: null };
        this.state.coachRelationships.push(rel);
      }
      this.audit('coach_relationship.identity_pending', 'coach_relationship', [rel.id, inv!.athleteId], 'coach_verification');
      return { relationshipId: rel.id, verificationState: rel.verificationState };
    });
  }

  private requestView(q: LoopRequest, rel: DemoCoachRelationship): CoachRequestView {
    const u = this.athleteUser(q.athleteId);
    const aud = this.audienceFor(rel);
    return {
      request: q,
      athleteName: u.displayName,
      athleteRef: shortRef(q.athleteId),
      athleteId: q.athleteId,
      focus: this.currentFocus(q.athleteId),
      audience: { members: aud.members, hash: aud.hash, gateFailures: this.gateFailures(rel) },
      draft: this.state.drafts.find((d) => d.requestId === q.id && d.coachId === this.actorId) ?? null,
      publication: this.state.publications.find((p) => p.requestId === q.id && p.isCurrent) ?? null,
      label: loopLabel(q),
      guardianLinks: activeGuardianLinksFor(this.state.guardianLinks, q.athleteId).map((l) => ({ linkId: l.id, guardianName: this.name(l.guardianUserId) })),
    };
  }

  async getCoachInbox(): Promise<CoachInbox> {
    this.expireDue();
    const me = this.me();
    const rels = this.state.coachRelationships.filter((r) => r.coachUserId === me.id && r.active);
    const verified = rels.filter((r) => isActiveVerifiedCoach(r));
    const reqs = this.state.loopRequests.filter((q) => verified.some((r) => r.id === q.coachRelationshipId));
    const views = reqs.map((q) => this.requestView(q, this.rel(q.coachRelationshipId))).sort((x, y) => x.request.dueAt.localeCompare(y.request.dueAt));
    return {
      displayName: me.displayName,
      // Pending/rejected/suspended coaches see the relationship exists but no reflection/request content.
      relationships: rels.map((r) => ({ relationshipId: r.id, athleteName: this.athleteUser(r.athleteId).displayName, athleteRef: shortRef(r.athleteId), athleteId: r.athleteId, verificationState: r.verificationState })),
      open: views.filter((v) => ACTIVE_REQUEST_STATES.includes(v.request.state)),
      recent: views.filter((v) => !ACTIVE_REQUEST_STATES.includes(v.request.state)).slice(-10).reverse(),
      briefs: this.state.briefs.filter((b) => b.authorCoachId === me.id && this.isVerifiedCoachOf(b.athleteId)).map((b) => ({ ...b, athleteName: this.athleteUser(b.athleteId).displayName })),
    };
  }

  async getCoachRequest(requestId: string) {
    this.expireDue();
    const { q, rel } = this.coachRequestFor(requestId);
    return this.requestView(q, rel);
  }

  async saveFeedbackDraft(requestId: string, input: FeedbackDraftInput, expectedVersion: number | null) {
    return this.mutate(() => {
      const { q } = this.coachRequestFor(requestId);
      if (!['waiting_for_coach', 'response_draft'].includes(q.state)) throw new DomainError('invalid_transition', 'This request is no longer open.');
      const parsed = feedbackDraftSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      let d = this.state.drafts.find((x) => x.requestId === requestId && x.coachId === this.actorId);
      if (!d) {
        d = { id: newId(), requestId, coachId: this.actorId!, ...parsed.data, aiSourceIds: [], aiModel: null, aiPromptVersion: null, state: 'manual_draft', reviewedAudienceHash: null, reviewedVersion: null, version: 1, createdAt: this.now(), updatedAt: this.now() };
        this.state.drafts.push(d);
      } else {
        if (expectedVersion !== null && d.version !== expectedVersion) throw new DomainError('conflict', 'Draft changed elsewhere. Reload.');
        if (d.state === 'published') throw new DomainError('invalid_transition', 'Already published. Publish a correction instead.');
        // Any edit invalidates a previous review.
        Object.assign(d, parsed.data, { state: 'manual_draft', reviewedAudienceHash: null, reviewedVersion: null, version: d.version + 1, updatedAt: this.now() });
      }
      if (q.state === 'waiting_for_coach') this.bumpRequest(q, 'response_draft');
      return { ...d };
    });
  }

  async requestAiSuggestion(requestId: string): Promise<AiSuggestionResult> {
    return this.mutateAsync(async () => {
      const { q } = this.coachRequestFor(requestId);
      if (!['waiting_for_coach', 'response_draft'].includes(q.state)) throw new DomainError('invalid_transition', 'This request is no longer open.');
      this.rateLimit('ai', 20, 3_600_000);
      // Only the shared snapshot for THIS request is sent — never the diary or other athletes.
      const sources: AiSource[] = [
        { id: q.id, kind: 'request_question', text: q.question },
        { id: q.reflectionId, kind: 'reflection_excerpt', text: q.sharedExcerpt },
      ];
      let raw: unknown;
      try {
        raw = mockCoachDraft({ athleteId: q.athleteId, sources });
      } catch {
        this.state.aiCalls.push({ at: this.now(), actor: this.actorId!, outcome: 'error' });
        return { ok: false, warnings: [], reason: 'AI is unavailable right now. Write your response manually — nothing was lost.' };
      }
      const v = validateAiOutput(raw, { athleteId: q.athleteId, sources, actionRecommendationsEnabled: false });
      this.state.aiCalls.push({ at: this.now(), actor: this.actorId!, outcome: v.ok ? 'ok' : 'invalid' });
      if (!v.ok) return { ok: false, warnings: [], reason: `The suggestion was discarded (${v.reason}). Write your response manually.` };
      if (v.value.insufficient_context) return { ok: false, warnings: v.warnings, reason: 'Not enough shared context for a useful suggestion. Write your response manually.' };
      let d = this.state.drafts.find((x) => x.requestId === requestId && x.coachId === this.actorId);
      const fields = { summary: v.value.summary, aiSourceIds: v.value.source_record_ids, aiModel: MOCK_MODEL, aiPromptVersion: AI_PROMPT_VERSION, state: 'ai_suggested' as const, reviewedAudienceHash: null, reviewedVersion: null, updatedAt: this.now() };
      if (!d) {
        d = { id: newId(), requestId, coachId: this.actorId!, oneNextAction: '', situation: '', measure: '', version: 1, createdAt: this.now(), ...fields };
        this.state.drafts.push(d);
      } else {
        if (d.state === 'published') throw new DomainError('invalid_transition', 'Already published.');
        Object.assign(d, fields, { version: d.version + 1 });
      }
      if (q.state === 'waiting_for_coach') this.bumpRequest(q, 'response_draft');
      return { ok: true, warnings: v.warnings, draft: { ...d } };
    });
  }

  async markReviewed(draftId: string, expectedVersion: number, audienceHash: string): Promise<FeedbackDraft> {
    return this.mutate(() => {
      const d = this.state.drafts.find((x) => x.id === draftId && x.coachId === this.actorId);
      if (!d) throw new DomainError('not_found', 'Draft not found.');
      const { rel } = this.coachRequestFor(d.requestId);
      if (d.version !== expectedVersion) throw new DomainError('stale_review', 'The draft changed. Review the latest version.');
      if (!d.oneNextAction.trim() || !d.situation.trim() || !d.measure.trim()) throw new DomainError('validation', 'One action, one situation and a simple measure are required.');
      if (this.audienceFor(rel).hash !== audienceHash) throw new DomainError('stale_review', 'The audience changed. Review again.');
      d.state = 'reviewed';
      d.version++;
      d.reviewedVersion = d.version;
      d.reviewedAudienceHash = audienceHash;
      d.updatedAt = this.now();
      return { ...d };
    });
  }

  async publishFeedback(input: { draftId: string; draftVersion: number; confirmedAudienceHash: string; idempotencyKey: string }) {
    return this.mutate(() => {
      const me = this.me();
      const dup = this.state.publications.find((p) => p.publishIdempotencyKey === input.idempotencyKey && p.coachId === me.id);
      if (dup) return { publicationId: dup.id, duplicate: true };
      const d = this.state.drafts.find((x) => x.id === input.draftId && x.coachId === me.id);
      if (!d) throw new DomainError('not_found', 'Draft not found.');
      const { q, rel } = this.coachRequestFor(d.requestId); // fresh authorization
      if (q.state !== 'response_draft') throw new DomainError('invalid_transition', 'This request cannot be published now.');
      if (d.state !== 'reviewed' || d.reviewedVersion !== d.version || d.version !== input.draftVersion) throw new DomainError('stale_review', 'Review the latest draft before publishing.');
      const gates = this.gateFailures(rel); // fresh Rule-of-Two check
      if (gates.length) throw new DomainError('second_adult_required', GATE_MESSAGES[gates[0]!]);
      const aud = this.audienceFor(rel);
      if (aud.hash !== input.confirmedAudienceHash || d.reviewedAudienceHash !== input.confirmedAudienceHash) throw new DomainError('stale_review', 'The audience changed since review. Review again.');
      const id = newId();
      this.state.publications.push({ id, requestId: q.id, athleteId: q.athleteId, coachId: me.id, draftId: d.id, summary: d.summary, oneNextAction: d.oneNextAction, situation: d.situation, measure: d.measure, approvedBy: me.id, approvedAt: this.now(), audience: aud, correctedFromId: null, isCurrent: true, version: 1, publishIdempotencyKey: input.idempotencyKey, createdAt: this.now() });
      d.state = 'published';
      this.bumpRequest(q, 'published');
      for (const m of aud.members) {
        if (m.role === 'athlete') this.notify(m.userId, 'coach_responded', 'You have new feedback in Loop', `/feedback/${q.id}`, `published:${id}:${m.userId}`);
        if (m.role === 'second_adult') this.notify(m.userId, 'coach_responded', 'You have new feedback in Loop', '/guardian', `published:${id}:${m.userId}`);
      }
      this.audit('feedback.published', 'feedback_publication', [id, q.id, q.athleteId], 'coach_exchange', 'published_to_audience', { audience_hash: aud.hash });
      return { publicationId: id, duplicate: false };
    });
  }

  async declineRequest(requestId: string) {
    this.mutate(() => {
      const { q } = this.coachRequestFor(requestId);
      this.bumpRequest(q, 'declined');
      for (const d of this.state.drafts) if (d.requestId === requestId && d.state !== 'published') d.state = 'rejected';
      this.notify(this.athlete(q.athleteId).userId, 'system', 'Your coach could not respond to this request', '/home', `declined:${requestId}`);
      this.audit('loop_request.declined', 'loop_request', [requestId], 'coach_exchange');
    });
  }

  async createBrief(input: { athleteId: string; guardianLinkId: string; somethingToSay: string; questionToAsk: string; habitToPraise: string; sourceIds: string[] }) {
    return this.mutate(() => {
      if (!this.isVerifiedCoachOf(input.athleteId)) throw new DomainError('forbidden', 'Verified coach required.');
      const link = this.state.guardianLinks.find((l) => l.id === input.guardianLinkId && l.athleteId === input.athleteId && l.status === 'active');
      if (!link) throw new DomainError('forbidden', 'Briefs go only to a verified linked guardian.');
      const parsed = parentBriefSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      const reflections = this.state.reflections.filter((r) => r.athleteId === input.athleteId);
      const shared = this.state.loopRequests.filter((q) => q.athleteId === input.athleteId).map((q) => ({ answerWell: q.sharedExcerpt, answerMomentBack: q.question, supportRequest: null }));
      if (briefLeaksDiary(parsed.data, [...reflections, ...shared])) throw new DomainError('validation', 'Briefs cannot quote or copy the athlete’s words. Write a short cue in your own words.');
      if (briefHasPressureLanguage(parsed.data)) throw new DomainError('validation', 'Avoid rankings, scores or pressure language in support cues.');
      const id = newId();
      this.state.briefs.push({ id, athleteId: input.athleteId, guardianLinkId: input.guardianLinkId, authorCoachId: this.actorId!, ...parsed.data, sourceIds: input.sourceIds, state: 'draft', reviewedBy: null, reviewedAt: null, publishedAt: null, createdAt: this.now(), updatedAt: this.now() });
      return { briefId: id };
    });
  }

  async advanceBrief(briefId: string, action: 'review' | 'publish' | 'revoke') {
    this.mutate(() => {
      const b = this.state.briefs.find((x) => x.id === briefId && x.authorCoachId === this.actorId);
      if (!b || !this.isVerifiedCoachOf(b.athleteId)) throw new DomainError('not_found', 'Brief not found.');
      if (action === 'review' && b.state === 'draft') Object.assign(b, { state: 'coach_reviewed', reviewedBy: this.actorId, reviewedAt: this.now() });
      else if (action === 'publish' && b.state === 'coach_reviewed') {
        const link = this.state.guardianLinks.find((l) => l.id === b.guardianLinkId && l.status === 'active');
        if (!link) throw new DomainError('forbidden', 'Guardian link is no longer active.');
        Object.assign(b, { state: 'published', publishedAt: this.now() });
        this.notify(link.guardianUserId!, 'brief_published', 'A new support cue is available', '/guardian', `brief:${b.id}`);
      } else if (action === 'revoke' && b.state === 'published') b.state = 'revoked';
      else throw new DomainError('invalid_transition', `Cannot ${action} a ${b.state.replace('_', ' ')} brief.`);
      b.updatedAt = this.now();
      this.audit(`parent_brief.${action}`, 'parent_brief', [briefId, b.athleteId], 'guardian_cues');
    });
  }

  async getTeamCoverage(): Promise<TeamCoverageCell[]> {
    const me = this.me();
    const teams = this.state.teams.filter((t) => this.state.memberships.some((m) => m.teamId === t.id && m.userId === me.id && m.role !== 'athlete' && m.status === 'active'));
    const now = this.clock();
    const window = { from: new Date(now.getTime() - 28 * 86_400_000).toISOString(), to: now.toISOString() };
    const cells = teams.map((t) => ({ key: t.id, value: teamCompletion(t.id, this.state.sessions, this.state.assignments, this.state.memberships, window) }));
    return suppressSmallCohorts(cells, DEFAULTS.minCohortSize, false).map((c) => {
      const label = teams.find((t) => t.id === c.key)?.name ?? c.key;
      return c.suppressed ? { key: c.key, label, suppressed: true, reason: c.reason } : { key: c.key, label, suppressed: false, expected: c.expected, completed: c.completed, rate: c.rate };
    });
  }

  // ------------------------------------------------------------------ settings, safety, rights
  async getSettings(): Promise<SettingsView> {
    const me = this.me();
    const a = this.athleteByUser(me.id);
    return {
      prefs: this.state.prefs.find((p) => p.userId === me.id) ?? { userId: me.id, inAppEnabled: true, emailReminders: false, smsReminders: false, quietHoursStart: 21, quietHoursEnd: 8, timezone: me.timezone, updatedAt: this.now() },
      consents: this.state.consents.filter((c) => c.subjectUserId === me.id || c.actorUserId === me.id),
      notifications: this.state.notifications.filter((n) => n.recipientUserId === me.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
      myAudit: this.state.audit.filter((e) => e.actorUserId === me.id || (a && e.targetIds.includes(a.id))).slice(-50).reverse(),
      deletionRequests: this.state.deletionRequests.filter((d) => d.subjectUserId === me.id),
      shares: this.state.grants.filter((g) => g.ownerAthleteId === a?.id).map((g) => ({ ...g, recipientName: this.name(g.recipientUserId) })),
      entitlement: a ? (({ active, fundingSource }) => ({ active, fundingSource }))(computeEntitlement(a.id, this.state.subscriptions, this.state.sponsorships, this.clock())) : null,
    };
  }

  async updatePreferences(input: { inAppEnabled: boolean; emailReminders: boolean; quietHoursStart: number; quietHoursEnd: number }) {
    this.mutate(() => {
      const me = this.me();
      if (input.emailReminders && !this.hasConsent(me.id, 'email_notifications')) throw new DomainError('consent_required', 'Turn on email consent first.');
      const p = this.state.prefs.find((x) => x.userId === me.id);
      if (!p) throw new DomainError('not_found', 'Preferences not found.');
      Object.assign(p, input, { updatedAt: this.now() });
    });
  }

  async markNotificationRead(id: string) {
    this.mutate(() => {
      const n = this.state.notifications.find((x) => x.id === id && x.recipientUserId === this.actorId);
      if (n && !n.readAt) n.readAt = this.now();
    });
  }

  async exportMyData() {
    const me = this.me();
    const a = this.athleteByUser(me.id);
    this.mutate(() => this.audit('data.exported', 'profile', [me.id], 'data_rights'));
    const strip = <T extends object>(o: T, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
    return {
      exported_at: this.now(),
      notice: 'Synthetic demo export. Contains only records about you that you are entitled to receive.',
      profile: { id: me.id, displayName: me.displayName, eligibilityBand: me.band, accountState: me.accountState, timezone: me.timezone },
      consents: this.state.consents.filter((c) => c.subjectUserId === me.id || c.actorUserId === me.id),
      reflections: a ? this.state.reflections.filter((r) => r.athleteId === a.id).map((r) => strip(r, ['idempotencyKey'])) : [],
      focusVersions: a ? this.state.focusVersions.filter((f) => f.athleteId === a.id) : [],
      loopRequests: a ? this.state.loopRequests.filter((q) => q.athleteId === a.id).map((q) => strip(q, ['idempotencyKey'])) : [],
      feedbackReceived: a ? this.state.publications.filter((p) => p.athleteId === a.id).map((p) => strip(p, ['publishIdempotencyKey'])) : [],
      feedbackGiven: this.state.publications.filter((p) => p.coachId === me.id).map((p) => strip(p, ['publishIdempotencyKey'])),
      voiceAssets: this.state.voiceAssets.filter((v) => v.ownerUserId === me.id).map((v) => ({ id: v.id, createdAt: v.createdAt, retentionState: v.retentionState })),
      sharingGrants: a ? this.state.grants.filter((g) => g.ownerAthleteId === a.id) : [],
      notificationPreferences: this.state.prefs.find((p) => p.userId === me.id) ?? null,
    };
  }

  async requestDeletion(scope: 'account' | 'voice_only' | 'reflections') {
    this.mutate(() => {
      const me = this.me();
      const id = newId();
      this.state.deletionRequests.push({ id, subjectUserId: me.id, scope, state: 'requested', createdAt: this.now() });
      if (scope === 'voice_only') for (const v of this.state.voiceAssets) if (v.ownerUserId === me.id && v.retentionState === 'active') v.retentionState = 'delete_pending';
      this.audit('deletion.requested', 'deletion_request', [id], 'data_rights', null, { scope });
    });
  }

  async reportConcern(input: { description: string; subjectAthleteId: string | null; referenceType: Concern['referenceType'] | null; referenceId: string | null }) {
    return this.mutate(() => {
      const parsed = concernSchema.safeParse(input);
      if (!parsed.success) throw new DomainError('validation', firstIssue(parsed.error));
      this.rateLimit('concern', 10, 86_400_000);
      const owner = this.state.users.find((u) => u.staffRoles.includes('safeguarding_owner'));
      const id = newId();
      this.state.concerns.push({ id, reporterUserId: this.me().id, subjectAthleteId: parsed.data.subjectAthleteId, subjectUserId: null, referenceType: parsed.data.referenceType, referenceId: parsed.data.referenceId, assignedSafeguardingOwner: owner?.id ?? null, severity: 'unassessed', state: 'open', description: parsed.data.description, evidenceRef: null, createdAt: this.now(), updatedAt: this.now() });
      this.audit('concern.reported', 'concern', [id], 'safeguarding');
      if (owner) this.notify(owner.id, 'system', 'A concern report needs review', '/admin', `concern:${id}`);
      return { routed: !!owner };
    });
  }

  async blockUser(userId: string) {
    this.mutate(() => {
      const me = this.me();
      if (!this.state.blocks.some((b) => b.blockerUserId === me.id && b.blockedUserId === userId)) this.state.blocks.push({ blockerUserId: me.id, blockedUserId: userId, createdAt: this.now() });
      const a = this.myAthlete();
      if (a) for (const r of this.state.coachRelationships) if (r.athleteId === a.id && r.coachUserId === userId && r.active) this.revokeCoachInternal(r.id);
      this.audit('user.blocked', 'profile', [userId], 'safety');
    });
  }

  // ------------------------------------------------------------------ admin
  async getAdmin(): Promise<AdminView> {
    const canReview = this.isStaff('verification_reviewer');
    const canSafeguard = this.isStaff('safeguarding_owner');
    if (!canReview && !canSafeguard && !this.isStaff('support_admin')) throw new DomainError('forbidden', 'Staff role with MFA required.');
    return {
      canReview,
      canSafeguard,
      queue: canReview
        ? [
            ...this.state.coachRelationships.filter((r) => r.active && ['identity_pending', 'suspended'].includes(r.verificationState)).map((r) => ({ kind: 'coach' as const, id: r.id, athleteRef: shortRef(r.athleteId), subjectName: this.name(r.coachUserId), state: r.verificationState, guardianApproved: isMinorBand(this.athleteUser(r.athleteId).band) ? !!r.guardianApprovedAt : null, createdAt: r.createdAt })),
            ...this.state.guardianLinks.filter((l) => l.status === 'pending_verification').map((l) => ({ kind: 'guardian' as const, id: l.id, athleteRef: shortRef(l.athleteId), subjectName: this.name(l.guardianUserId), state: l.status, guardianApproved: null, createdAt: l.createdAt })),
          ]
        : [],
      concerns: canSafeguard ? this.state.concerns : [],
      // Support sees minimal operational metadata only (audit events carry no content).
      audit: this.state.audit.slice(-100).reverse(),
    };
  }

  async reviewCoach(relationshipId: string, decision: 'verify' | 'reject' | 'suspend' | 'reinstate', evidenceRef: string) {
    this.mutate(() => {
      if (!this.isStaff('verification_reviewer')) throw new DomainError('forbidden', 'Verification reviewer with MFA required.');
      if (!evidenceRef.trim()) throw new DomainError('validation', 'Evidence reference required.');
      const r = this.rel(relationshipId);
      if (r.coachUserId === this.actorId || this.athlete(r.athleteId).userId === this.actorId || this.isActiveGuardian(r.athleteId)) throw new DomainError('forbidden', 'Reviewers cannot verify their own relationships.');
      const next: CoachVerificationState = decision === 'verify' || decision === 'reinstate' ? 'verified' : decision === 'reject' ? 'rejected' : 'suspended';
      const ok = (['invited', 'identity_pending'].includes(r.verificationState) && ['verified', 'rejected'].includes(next)) || (r.verificationState === 'verified' && next === 'suspended') || (r.verificationState === 'suspended' && ['verified', 'rejected'].includes(next));
      if (!ok) throw new DomainError('invalid_transition', `Cannot move a ${r.verificationState} coach to ${next}.`);
      if (next === 'verified') {
        if (!r.athleteConfirmedAt) throw new DomainError('validation', 'Athlete has not approved this coach.');
        if (isMinorBand(this.athleteUser(r.athleteId).band) && !r.guardianApprovedAt) throw new DomainError('validation', 'A linked guardian must approve this coach first.');
        Object.assign(r, { verificationState: next, verifiedBy: this.actorId, verifiedAt: this.now(), verificationEvidenceRef: evidenceRef.trim() });
      } else {
        Object.assign(r, { verificationState: next, verificationEvidenceRef: evidenceRef.trim() });
        this.cancelActiveRequests(r.athleteId, `coach_${next}`, r.id);
      }
      r.updatedAt = this.now();
      this.audit(`coach_relationship.${next}`, 'coach_relationship', [relationshipId, r.athleteId], 'coach_verification', null, { evidence_ref: evidenceRef.trim().slice(0, 100) });
    });
  }

  async reviewGuardianLink(linkId: string, decision: 'verify' | 'reject', evidenceRef: string) {
    this.mutate(() => {
      if (!this.isStaff('verification_reviewer')) throw new DomainError('forbidden', 'Verification reviewer with MFA required.');
      if (!evidenceRef.trim()) throw new DomainError('validation', 'Evidence reference required.');
      const l = this.state.guardianLinks.find((x) => x.id === linkId && x.status === 'pending_verification');
      if (!l) throw new DomainError('invalid_transition', 'Link is not pending verification.');
      if (l.guardianUserId === this.actorId || this.athlete(l.athleteId).userId === this.actorId) throw new DomainError('forbidden', 'Reviewers cannot verify their own relationships.');
      if (decision === 'verify') Object.assign(l, { status: 'active', verifiedBy: this.actorId, verifiedAt: this.now(), verificationEvidenceRef: evidenceRef.trim() });
      else Object.assign(l, { status: 'rejected', verificationEvidenceRef: evidenceRef.trim() });
      l.updatedAt = this.now();
      this.audit(`guardian_link.${decision}`, 'guardian_link', [linkId, l.athleteId], 'guardian_verification', null, { evidence_ref: evidenceRef.trim().slice(0, 100) });
    });
  }

  async triageConcern(concernId: string, state: Concern['state'], severity: Concern['severity']) {
    this.mutate(() => {
      if (!this.isStaff('safeguarding_owner')) throw new DomainError('forbidden', 'Safeguarding owner with MFA required.');
      const c = this.state.concerns.find((x) => x.id === concernId);
      if (!c) throw new DomainError('not_found', 'Concern not found.');
      Object.assign(c, { state, severity, updatedAt: this.now() });
      this.audit('concern.triaged', 'concern', [concernId], 'safeguarding', null, { state, severity });
    });
  }

  // ------------------------------------------------------------------ billing (demo, test-mode semantics)
  /** DEMO ONLY: illustrate the no-double-billing guard. No payment is ever processed. */
  async simulateCheckout(athleteId: string): Promise<void> {
    assertCheckoutAllowed(athleteId, this.state.subscriptions, this.state.sponsorships, this.clock());
    throw new DomainError('feature_disabled', 'Billing is off in this pilot build. No payment can be taken.');
  }
}

export type { ConsentRecord };
