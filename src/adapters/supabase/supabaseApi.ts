/**
 * Real Supabase adapter. Identity comes only from the Supabase Auth session (JWT); every read is
 * filtered by RLS and every mutation goes through a SECURITY DEFINER RPC that re-checks authority.
 * The browser holds only the publishable key. There is no role switcher here — by construction.
 *
 * NOTE: This adapter is type-checked and its SQL is integration-tested on PostgreSQL 16 with a
 * Supabase shim, but it has NOT been exercised against a live Supabase project in this build.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  DomainError,
  loopLabel,
  organizeSolo,
  type AccountState,
  type ConsentPurpose,
  type DomainErrorCode,
  type FeedbackDraft,
  type FeedbackDraftInput,
  type FeedbackPublication,
  type FocusProposalInput,
  type FocusVersion,
  type LoopRequest,
  type LoopRequestInput,
  type ReflectionDraftInput,
  type ReflectionSubmitInput,
  type Reflection,
  type SharingGrant,
  type Concern,
  type EligibilityBand,
  type CoachVerificationState,
  type ExchangeGateFailure,
  type ParentBrief,
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
  LoopApi,
  PendingStatus,
  SettingsView,
  TeamCoverageCell,
  TimelineItem,
  Viewer,
} from '../../api/types';
import { shortRef } from '../../api/types';

const POLICY_VERSION = 'pilot-2026-10';
type Row = Record<string, unknown>;

const camelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function camel<T>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => camel(x)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [camelKey(k), camel(x)])) as T;
  return v as T;
}

/** Maps "LOOP:<code>:<message>" raised by RPCs to DomainError; never leaks raw SQL to users. */
export function mapError(e: { message?: string; code?: string } | null): DomainError {
  const msg = e?.message ?? '';
  const m = msg.match(/LOOP:([a-z_]+):(.*)$/s);
  if (m) return new DomainError(m[1] as DomainErrorCode, m[2]!.trim());
  if (e?.code === '42501' || /permission denied|row-level security/i.test(msg)) return new DomainError('forbidden', 'You do not have access to this.');
  if (/check constraint|violates/i.test(msg)) return new DomainError('validation', 'Some input was not accepted. Check lengths and required fields.');
  return new DomainError('conflict', 'Something went wrong. Please try again.');
}

const focusFromRow = (r: Row): FocusVersion => {
  const c = camel<FocusVersion & { nowText: string; focusPlanId: string }>(r);
  return { ...c, now: c.nowText };
};
const requestFromRow = (r: Row): LoopRequest => {
  const c = camel<LoopRequest & { audienceHash: string }>(r);
  return { ...c, audience: { ...(c.audience as LoopRequest['audience']), hash: c.audienceHash } };
};
const pubFromRow = (r: Row): FeedbackPublication => {
  const c = camel<FeedbackPublication & { audienceHash: string }>(r);
  return { ...c, audience: { ...(c.audience as FeedbackPublication['audience']), hash: c.audienceHash } };
};

export class SupabaseApi implements LoopApi {
  readonly kind = 'supabase' as const;
  readonly client: SupabaseClient;
  private nameCache = new Map<string, string>();

  constructor(url: string, publishableKey: string) {
    this.client = createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw mapError(error);
    return data as T;
  }
  private async rows(table: string, build?: (q: ReturnType<SupabaseClient['from']>['select']) => unknown, columns = '*'): Promise<Row[]> {
    let q = this.client.from(table).select(columns);
    if (build) q = build(q as never) as typeof q;
    const { data, error } = await q;
    if (error) throw mapError(error);
    return (data ?? []) as unknown as Row[];
  }
  private async uid(): Promise<string> {
    const { data } = await this.client.auth.getUser();
    if (!data.user) throw new DomainError('unauthorized', 'Sign in required.');
    return data.user.id;
  }
  private async names(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const missing = [...new Set(ids.filter((x): x is string => !!x && !this.nameCache.has(x)))];
    if (missing.length) {
      const { data } = await this.client.from('profiles').select('id, display_name').in('id', missing);
      for (const p of (data ?? []) as Row[]) this.nameCache.set(p.id as string, p.display_name as string);
    }
    return this.nameCache;
  }
  private async name(id: string | null | undefined): Promise<string> {
    if (!id) return 'Unknown';
    return (await this.names([id])).get(id) ?? 'Someone';
  }
  private async myAthleteId(): Promise<string | null> {
    const uid = await this.uid();
    const { data } = await this.client.from('athletes').select('id').eq('user_id', uid).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  private async coachSummaries(athleteId: string): Promise<CoachSummary[]> {
    const rels = await this.rows('coach_relationships', (q) => (q as never as { eq: (a: string, b: unknown) => unknown }).eq('athlete_id', athleteId));
    await this.names(rels.flatMap((r) => [r.coach_user_id as string, r.second_adult_user_id as string]));
    return rels.filter((r) => r.active).map((r) => ({
      relationshipId: r.id as string,
      coachUserId: r.coach_user_id as string,
      coachName: this.nameCache.get(r.coach_user_id as string) ?? 'Coach',
      verificationState: r.verification_state as CoachVerificationState,
      secondAdultName: r.second_adult_user_id ? this.nameCache.get(r.second_adult_user_id as string) ?? 'Guardian' : null,
      guardianApproved: !!r.guardian_approved_at,
      active: !!r.active,
    }));
  }

  // ------------------------------------------------------------------ viewer
  async getViewer(): Promise<Viewer | null> {
    const { data: s } = await this.client.auth.getSession();
    if (!s.session) return null;
    const uid = s.session.user.id;
    const { data: p } = await this.client.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (!p) return null;
    const [{ data: a }, { data: staff }, { data: links }, { data: rels }, aal] = await Promise.all([
      this.client.from('athletes').select('id').eq('user_id', uid).maybeSingle(),
      this.client.from('staff_roles').select('role').eq('user_id', uid).is('revoked_at', null),
      this.client.from('guardian_links').select('id').eq('guardian_user_id', uid).in('status', ['pending_verification', 'active']),
      this.client.from('coach_relationships').select('id').eq('coach_user_id', uid).eq('active', true),
      this.client.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    return {
      userId: uid,
      displayName: p.display_name as string,
      eligibilityBand: p.eligibility_band as EligibilityBand,
      accountState: p.account_state as AccountState,
      athleteId: (a?.id as string | undefined) ?? null,
      isGuardian: (links ?? []).length > 0,
      isCoach: (rels ?? []).length > 0,
      staffRoles: ((staff ?? []) as Row[]).map((r) => r.role as Viewer['staffRoles'][number]),
      aal: aal.data?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
    };
  }
  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.nameCache.clear();
  }
  /** Passwordless email sign-in. Email verification proves account control only. */
  async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin, shouldCreateUser: true } });
    if (error) throw new DomainError('rate_limited', 'Could not send the sign-in link. Try again shortly.');
  }
  async registerAdult(displayName: string, timezone: string): Promise<void> {
    await this.rpc('register_profile', { p_display_name: displayName, p_eligibility_band: '18_plus', p_timezone: timezone, p_as_athlete: false, p_privacy_policy_version: POLICY_VERSION });
  }

  // ------------------------------------------------------------------ onboarding
  async startAthlete(input: { displayName: string; eligibilityBand: EligibilityBand; timezone: string }): Promise<Viewer> {
    await this.rpc('register_profile', { p_display_name: input.displayName, p_eligibility_band: input.eligibilityBand, p_timezone: input.timezone, p_as_athlete: true, p_privacy_policy_version: POLICY_VERSION });
    const v = await this.getViewer();
    if (!v) throw new DomainError('unauthorized', 'Sign in required.');
    return v;
  }
  async getPendingStatus(): Promise<PendingStatus> {
    const athleteId = await this.myAthleteId();
    if (!athleteId) throw new DomainError('forbidden', 'Not an athlete account.');
    const v = await this.getViewer();
    const invites = await this.rows('guardian_invites', undefined, 'id, intended_email_hint, expires_at, redeemed_at, revoked_at');
    const links = await this.rows('guardian_links');
    await this.names(links.map((l) => l.guardian_user_id as string));
    const now = new Date().toISOString();
    const consents = await this.rows('consent_records');
    const has = (p: string) => consents.some((c) => c.purpose === p && !c.withdrawn_at);
    const gaps: PendingStatus['gaps'] = [];
    if (!has('privacy_notice')) gaps.push('privacy_notice');
    if (v?.eligibilityBand !== '18_plus') {
      if (v?.eligibilityBand === 'under_13') gaps.push('under_13_review');
      if (!links.some((l) => l.status === 'active')) gaps.push('verified_guardian_link');
      if (!has('guardian_consent')) gaps.push('guardian_consent');
      if (!has('athlete_assent')) gaps.push('athlete_assent');
    }
    return {
      displayName: v?.displayName ?? '',
      gaps,
      invites: invites.map((i) => ({ id: i.id as string, label: 'Guardian', hint: i.intended_email_hint as string, expiresAt: i.expires_at as string, state: i.revoked_at ? 'revoked' : i.redeemed_at ? 'redeemed' : (i.expires_at as string) <= now ? 'expired' : 'pending' })),
      linkStates: links.map((l) => ({ id: l.id as string, status: l.status as string, guardianName: l.guardian_user_id ? this.nameCache.get(l.guardian_user_id as string) ?? null : null })),
    };
  }
  async createGuardianInvite(email: string): Promise<CreatedInvite> {
    const r = await this.rpc<{ invite_id: string; token: string; expires_at: string }>('create_guardian_invite', { p_guardian_email: email });
    // Real email delivery happens only via the notify Edge Function when an approved provider is configured.
    return { inviteId: r.invite_id, link: `${window.location.origin}/guardian/accept#token=${r.token}`, expiresAt: r.expires_at, delivery: 'simulated_copy_link' };
  }
  async cancelGuardianInvite(inviteId: string) {
    await this.rpc('cancel_guardian_invite', { p_invite_id: inviteId });
  }
  async recordConsent(purpose: ConsentPurpose, athleteId?: string) {
    const r = await this.rpc<{ account_state: AccountState | null }>('record_consent', { p_purpose: purpose, p_policy_version: POLICY_VERSION, p_scope: [], p_athlete_id: athleteId ?? null });
    return { accountState: r.account_state };
  }
  async withdrawConsent(consentId: string) {
    await this.rpc('withdraw_consent', { p_consent_id: consentId });
  }

  // ------------------------------------------------------------------ athlete
  async getAthleteHome(): Promise<AthleteHome> {
    const v = await this.getViewer();
    if (!v?.athleteId) throw new DomainError('forbidden', 'Not an athlete account.');
    const id = v.athleteId;
    const now = new Date().toISOString();
    const [sessions, assignments, focus, requests, reflections] = await Promise.all([
      this.client.from('activity_sessions').select('*').eq('athlete_id', id).eq('state', 'scheduled').gt('starts_at', now).order('starts_at').limit(1),
      this.client.from('assignments').select('id, due_at').eq('athlete_id', id).in('state', ['open', 'draft']).order('due_at').limit(1),
      this.client.from('focus_versions').select('*').eq('athlete_id', id).order('created_at', { ascending: false }),
      this.client.from('loop_requests').select('*').eq('athlete_id', id).order('created_at', { ascending: false }).limit(1),
      this.client.from('reflections').select('*').eq('athlete_id', id).eq('state', 'submitted').order('submitted_at', { ascending: false }).limit(3),
    ]);
    const fv = ((focus.data ?? []) as Row[]).map(focusFromRow);
    const latest = (requests.data ?? [])[0] as Row | undefined;
    const coaches = await this.coachSummaries(id);
    await this.names(fv.map((f) => f.authorId));
    const latestReq = latest ? requestFromRow(latest) : null;
    return {
      displayName: v.displayName,
      athleteId: id,
      eligibilityBand: v.eligibilityBand,
      nextSession: sessions.data?.[0] ? camel(sessions.data[0]) : null,
      openAssignmentId: (assignments.data?.[0]?.id as string | undefined) ?? null,
      currentFocus: fv.find((f) => f.acceptedAt && !f.supersededAt) ?? null,
      focusProposals: fv.filter((f) => !f.acceptedAt && !(f as FocusVersion & { declinedAt?: string }).declinedAt).map((f) => ({ ...f, authorName: this.nameCache.get(f.authorId) ?? 'Coach' })),
      latestRequest: latestReq ? { request: latestReq, label: loopLabel(latestReq), coachName: coaches.find((c) => c.relationshipId === latestReq.coachRelationshipId)?.coachName ?? 'Coach' } : null,
      coaches,
      recentReflections: camel<Reflection[]>(reflections.data ?? []),
    };
  }
  async createSession(input: { title: string; sport: string | null; startsAt: string; nextSessionAt: string | null }) {
    const r = await this.rpc<{ session_id: string; assignment_id: string }>('create_personal_session', { p_title: input.title, p_sport: input.sport, p_starts_at: input.startsAt, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, p_next_session_at: input.nextSessionAt });
    return { sessionId: r.session_id, assignmentId: r.assignment_id };
  }
  async cancelSession(sessionId: string) {
    await this.rpc('cancel_session', { p_session_id: sessionId });
  }
  async getDraft(assignmentId: string | null) {
    const id = await this.myAthleteId();
    let q = this.client.from('reflections').select('*').eq('athlete_id', id).eq('state', 'draft');
    q = assignmentId ? q.eq('assignment_id', assignmentId) : q.is('assignment_id', null);
    const { data } = await q.order('updated_at', { ascending: false }).limit(1);
    return data?.[0] ? camel<Reflection>(data[0]) : null;
  }
  async saveDraft(input: ReflectionDraftInput & { reflectionId: string | null; assignmentId: string | null; expectedVersion: number | null }) {
    const r = await this.rpc<{ reflection_id: string; version: number }>('save_reflection_draft', { p_reflection_id: input.reflectionId, p_assignment_id: input.assignmentId, p_answer_well: input.answerWell, p_answer_moment_back: input.answerMomentBack, p_support_request: input.supportRequest, p_mood: input.mood, p_expected_version: input.expectedVersion });
    return { reflectionId: r.reflection_id, version: r.version };
  }
  async submitReflection(input: ReflectionSubmitInput & { reflectionId: string | null; assignmentId: string | null }) {
    const r = await this.rpc<{ reflection_id: string; duplicate: boolean }>('submit_reflection', { p_reflection_id: input.reflectionId, p_assignment_id: input.assignmentId, p_answer_well: input.answerWell, p_answer_moment_back: input.answerMomentBack, p_support_request: input.supportRequest, p_mood: input.mood, p_idempotency_key: input.idempotencyKey });
    return { reflectionId: r.reflection_id, duplicate: r.duplicate };
  }
  async getReflection(id: string) {
    const { data, error } = await this.client.from('reflections').select('*').eq('id', id).maybeSingle();
    if (error || !data) throw new DomainError('not_found', 'Reflection not found.');
    return camel<Reflection>(data);
  }
  async organizeSolo(reflectionId: string) {
    const r = await this.getReflection(reflectionId);
    const home = await this.getAthleteHome();
    return organizeSolo(r, home.currentFocus);
  }
  async proposeFocus(input: FocusProposalInput & { athleteId: string; accept: boolean }) {
    const r = await this.rpc<{ focus_version_id: string; accepted: boolean }>('propose_focus', { p_athlete_id: input.athleteId, p_now: input.now, p_next_action: input.nextAction, p_next_situation: input.nextSituation, p_next_measure: input.nextMeasure, p_north_star: input.northStar, p_categories: input.categories ?? [], p_source_ids: input.sourceIds, p_change_reason: input.changeReason, p_accept: input.accept });
    return { focusVersionId: r.focus_version_id, accepted: r.accepted };
  }
  async acceptFocus(id: string) {
    await this.rpc('accept_focus_version', { p_focus_version_id: id });
  }
  async declineFocus(id: string) {
    await this.rpc('decline_focus_version', { p_focus_version_id: id });
  }
  async getTimeline(): Promise<TimelineItem[]> {
    const id = await this.myAthleteId();
    const [refl, pubs, focus, reqs] = await Promise.all([
      this.client.from('reflections').select('*').eq('athlete_id', id).eq('state', 'submitted'),
      this.client.from('feedback_publications').select('*').eq('athlete_id', id),
      this.client.from('focus_versions').select('*').eq('athlete_id', id).not('accepted_at', 'is', null),
      this.client.from('loop_requests').select('*').eq('athlete_id', id),
    ]);
    const coaches = await this.coachSummaries(id!);
    const pubRows = ((pubs.data ?? []) as Row[]).map(pubFromRow);
    const focusRows = ((focus.data ?? []) as Row[]).map(focusFromRow);
    await this.names([...pubRows.map((p) => p.coachId), ...focusRows.map((f) => f.authorId)]);
    const items: TimelineItem[] = [
      ...camel<Reflection[]>(refl.data ?? []).map((r) => ({ kind: 'reflection' as const, at: r.submittedAt!, source: 'athlete_words' as const, reflection: r })),
      ...pubRows.map((p) => ({ kind: 'feedback' as const, at: p.approvedAt, source: 'coach_observation' as const, publication: p, coachName: this.nameCache.get(p.coachId) ?? 'Coach' })),
      ...focusRows.map((f) => ({ kind: 'focus' as const, at: f.acceptedAt!, source: f.authorRole === 'athlete' ? ('athlete_words' as const) : ('coach_observation' as const), focus: f, authorName: this.nameCache.get(f.authorId) ?? '' })),
      ...((reqs.data ?? []) as Row[]).map(requestFromRow).map((q) => ({ kind: 'request' as const, at: q.createdAt, source: 'athlete_words' as const, request: q, label: loopLabel(q), coachName: coaches.find((c) => c.relationshipId === q.coachRelationshipId)?.coachName ?? 'Coach' })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }
  async listCoaches() {
    const id = await this.myAthleteId();
    if (!id) throw new DomainError('forbidden', 'Not an athlete account.');
    const invites = await this.rows('coach_invites', undefined, 'id, coach_display_name, intended_email_hint, expires_at, redeemed_at, revoked_at');
    const now = new Date().toISOString();
    return {
      coaches: await this.coachSummaries(id),
      invites: invites.map((i) => ({ id: i.id as string, label: i.coach_display_name as string, hint: i.intended_email_hint as string, expiresAt: i.expires_at as string, state: (i.revoked_at ? 'revoked' : i.redeemed_at ? 'redeemed' : (i.expires_at as string) <= now ? 'expired' : 'pending') as 'pending' })),
    };
  }
  async createCoachInvite(input: { coachDisplayName: string; coachEmail: string }): Promise<CreatedInvite> {
    const r = await this.rpc<{ invite_id: string; token: string; expires_at: string }>('create_coach_invite', { p_coach_name: input.coachDisplayName, p_coach_email: input.coachEmail });
    return { inviteId: r.invite_id, link: `${window.location.origin}/coach/accept#token=${r.token}`, expiresAt: r.expires_at, delivery: 'simulated_copy_link' };
  }
  async revokeCoachInvite(inviteId: string) {
    await this.rpc('revoke_coach_invite', { p_invite_id: inviteId });
  }
  async revokeCoach(relationshipId: string) {
    await this.rpc('revoke_coach_relationship', { p_rel_id: relationshipId });
  }
  async previewAudience(relationshipId: string): Promise<AudiencePreview> {
    const r = await this.rpc<{ members: AudiencePreview['members']; hash: string; gate_failures: ExchangeGateFailure[] }>('preview_exchange_audience', { p_rel_id: relationshipId });
    return { members: r.members, hash: r.hash, gateFailures: r.gate_failures };
  }
  async createLoopRequest(input: LoopRequestInput) {
    const r = await this.rpc<{ request_id: string; duplicate: boolean }>('create_loop_request', { p_reflection_id: input.reflectionId, p_rel_id: input.coachRelationshipId, p_shared_excerpt: input.sharedExcerpt, p_question: input.question, p_confirmed_audience_hash: input.confirmedAudienceHash, p_idempotency_key: input.idempotencyKey });
    return { requestId: r.request_id, duplicate: r.duplicate };
  }
  async cancelLoopRequest(requestId: string) {
    await this.rpc('cancel_loop_request', { p_request_id: requestId });
  }
  async getFeedback(requestId: string): Promise<FeedbackView> {
    const { data } = await this.client.from('loop_requests').select('*').eq('id', requestId).maybeSingle();
    if (!data) throw new DomainError('not_found', 'Request not found.');
    const q = requestFromRow(data);
    const [{ data: pubs }, { data: rel }, home] = await Promise.all([
      this.client.from('feedback_publications').select('*').eq('request_id', requestId).order('version'),
      this.client.from('coach_relationships').select('coach_user_id, verification_state, active').eq('id', q.coachRelationshipId).maybeSingle(),
      this.getAthleteHome(),
    ]);
    const history = ((pubs ?? []) as Row[]).map(pubFromRow);
    return { request: q, label: loopLabel(q), coachName: await this.name(rel?.coach_user_id as string), coachVerified: rel?.verification_state === 'verified' && !!rel?.active, publication: history.find((p) => p.isCurrent) ?? null, history, currentFocus: home.currentFocus };
  }
  async acknowledgeFeedback(requestId: string, close: boolean) {
    await this.rpc('acknowledge_feedback', { p_request_id: requestId, p_close: close });
  }
  async grantShare(input: { recordType: SharingGrant['recordType']; recordId: string; recipientUserId: string; surface: SharingGrant['surface']; purpose: string }) {
    await this.rpc('grant_share', { p_record_type: input.recordType, p_record_id: input.recordId, p_recipient: input.recipientUserId, p_surface: input.surface, p_purpose: input.purpose });
  }
  async revokeShare(grantId: string) {
    await this.rpc('revoke_share', { p_grant_id: grantId });
  }
  async simulateVoiceTranscript(): Promise<{ transcript: string; simulated: true }> {
    // Production transcription adapter stays OFF until processor/privacy/retention review.
    throw new DomainError('feature_disabled', 'Voice transcription is not enabled in this environment. Type your answer instead.');
  }

  // ------------------------------------------------------------------ guardian
  async redeemGuardianInvite(token: string) {
    const r = await this.rpc<{ link_id: string; status: string }>('redeem_guardian_invite', { p_token: token });
    return { linkId: r.link_id, status: r.status };
  }
  async getGuardianHome(): Promise<GuardianHome> {
    const uid = await this.uid();
    const v = await this.getViewer();
    const links = await this.rows('guardian_links');
    const mine = links.filter((l) => l.guardian_user_id === uid && ['pending_verification', 'active'].includes(l.status as string));
    const children = await Promise.all(
      mine.map(async (l) => {
        const athleteId = l.athlete_id as string;
        const { data: a } = await this.client.from('athletes').select('user_id').eq('id', athleteId).maybeSingle();
        const { data: p } = a ? await this.client.from('profiles').select('display_name, account_state').eq('id', a.user_id).maybeSingle() : { data: null };
        const active = l.status === 'active';
        const [reqs, pubs, briefs, focus, coaches] = active
          ? await Promise.all([
              this.client.from('loop_requests').select('*').eq('athlete_id', athleteId).order('created_at', { ascending: false }),
              this.client.from('feedback_publications').select('*').eq('athlete_id', athleteId).eq('is_current', true),
              this.client.from('parent_briefs').select('*').eq('guardian_link_id', l.id).eq('state', 'published'),
              this.client.from('focus_versions').select('*').eq('athlete_id', athleteId).not('accepted_at', 'is', null).is('superseded_at', null),
              this.coachSummaries(athleteId),
            ])
          : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, [] as CoachSummary[]];
        const pubRows = ((pubs.data ?? []) as Row[]).map(pubFromRow);
        const consents = await this.rows('consent_records');
        return {
          athleteId,
          displayName: (p?.display_name as string) ?? 'Athlete',
          accountState: (p?.account_state as AccountState) ?? 'pending_guardian',
          linkId: l.id as string,
          linkStatus: l.status as string,
          guardianConsentGiven: consents.some((c) => c.purpose === 'guardian_consent' && !c.withdrawn_at && c.actor_user_id === uid),
          gaps: [],
          focus: ((focus.data ?? []) as Row[]).map(focusFromRow)[0] ?? null,
          sharedThreads: ((reqs.data ?? []) as Row[]).map(requestFromRow).map((q) => ({ request: q, publication: pubRows.find((x) => x.requestId === q.id) ?? null, coachName: coaches.find((c) => c.relationshipId === q.coachRelationshipId)?.coachName ?? 'Coach', label: loopLabel(q) })),
          briefs: camel<ParentBrief[]>(briefs.data ?? []),
          coachesAwaitingApproval: coaches.filter((c) => !c.guardianApproved && ['invited', 'identity_pending'].includes(c.verificationState)),
          coaches,
        };
      }),
    );
    return { displayName: v?.displayName ?? '', children };
  }
  async approveCoach(relationshipId: string) {
    await this.rpc('guardian_approve_coach', { p_rel_id: relationshipId });
  }
  async revokeGuardianLink(linkId: string) {
    await this.rpc('revoke_guardian_link', { p_link_id: linkId });
  }

  // ------------------------------------------------------------------ coach
  async redeemCoachInvite(token: string) {
    const r = await this.rpc<{ relationship_id: string; verification_state: CoachVerificationState }>('redeem_coach_invite', { p_token: token });
    return { relationshipId: r.relationship_id, verificationState: r.verification_state };
  }
  private async coachView(q: LoopRequest): Promise<CoachRequestView> {
    const uid = await this.uid();
    const [{ data: a }, focus, drafts, pubs, audience] = await Promise.all([
      this.client.from('athletes').select('user_id').eq('id', q.athleteId).maybeSingle(),
      this.client.from('focus_versions').select('*').eq('athlete_id', q.athleteId).not('accepted_at', 'is', null).is('superseded_at', null),
      this.client.from('feedback_drafts').select('*').eq('request_id', q.id).eq('coach_id', uid),
      this.client.from('feedback_publications').select('*').eq('request_id', q.id).eq('is_current', true),
      this.previewAudience(q.coachRelationshipId),
    ]);
    // Coaches cannot read guardian_links under RLS. Briefs are addressed to the relationship's second adult;
    // the server resolves that adult's active, verified link (empty linkId => server-side resolution).
    const second = audience.members.find((m) => m.role === 'second_adult');
    const links = second ? [{ linkId: '', guardianName: second.displayName }] : [];
    return {
      request: q,
      athleteName: await this.name(a?.user_id as string),
      athleteRef: shortRef(q.athleteId),
      athleteId: q.athleteId,
      focus: ((focus.data ?? []) as Row[]).map(focusFromRow)[0] ?? null,
      audience,
      draft: drafts.data?.[0] ? camel<FeedbackDraft>(drafts.data[0]) : null,
      publication: pubs.data?.[0] ? pubFromRow(pubs.data[0]) : null,
      label: loopLabel(q),
      guardianLinks: links,
    };
  }
  async getCoachInbox(): Promise<CoachInbox> {
    const uid = await this.uid();
    const v = await this.getViewer();
    const rels = (await this.rows('coach_relationships')).filter((r) => r.coach_user_id === uid && r.active);
    const athleteIds = rels.map((r) => r.athlete_id as string);
    const { data: athletes } = await this.client.from('athletes').select('id, user_id').in('id', athleteIds);
    await this.names(((athletes ?? []) as Row[]).map((x) => x.user_id as string));
    const nameOf = (athleteId: string) => this.nameCache.get(((athletes ?? []) as Row[]).find((x) => x.id === athleteId)?.user_id as string) ?? `Athlete ${shortRef(athleteId)}`;
    const { data: reqs } = await this.client.from('loop_requests').select('*').order('due_at');
    const views = await Promise.all(((reqs ?? []) as Row[]).map(requestFromRow).map((q) => this.coachView(q)));
    const { data: briefs } = await this.client.from('parent_briefs').select('*').eq('author_coach_id', uid);
    const active = ['queued', 'waiting_for_coach', 'response_draft'];
    return {
      displayName: v?.displayName ?? '',
      relationships: rels.map((r) => ({ relationshipId: r.id as string, athleteName: nameOf(r.athlete_id as string), athleteRef: shortRef(r.athlete_id as string), athleteId: r.athlete_id as string, verificationState: r.verification_state as CoachVerificationState })),
      open: views.filter((x) => active.includes(x.request.state)),
      recent: views.filter((x) => !active.includes(x.request.state)).slice(0, 10),
      briefs: camel<ParentBrief[]>(briefs ?? []).map((b) => ({ ...b, athleteName: nameOf(b.athleteId) })),
    };
  }
  async getCoachRequest(requestId: string) {
    const { data } = await this.client.from('loop_requests').select('*').eq('id', requestId).maybeSingle();
    if (!data) throw new DomainError('not_found', 'Request not found.');
    return this.coachView(requestFromRow(data));
  }
  async saveFeedbackDraft(requestId: string, input: FeedbackDraftInput, expectedVersion: number | null) {
    const r = await this.rpc<{ draft_id: string }>('coach_save_draft', { p_request_id: requestId, p_summary: input.summary, p_one_next_action: input.oneNextAction, p_situation: input.situation, p_measure: input.measure, p_expected_version: expectedVersion });
    const { data } = await this.client.from('feedback_drafts').select('*').eq('id', r.draft_id).single();
    return camel<FeedbackDraft>(data);
  }
  async requestAiSuggestion(requestId: string): Promise<AiSuggestionResult> {
    const { data, error } = await this.client.functions.invoke('ai-draft', { body: { request_id: requestId } });
    if (error) return { ok: false, warnings: [], reason: 'AI is unavailable right now. Write your response manually — nothing was lost.' };
    const out = data as { ok: boolean; warnings?: string[]; reason?: string; draft_id?: string };
    if (!out.ok || !out.draft_id) return { ok: false, warnings: out.warnings ?? [], reason: out.reason ?? 'No suggestion. Write your response manually.' };
    const { data: d } = await this.client.from('feedback_drafts').select('*').eq('id', out.draft_id).single();
    return { ok: true, warnings: out.warnings ?? [], draft: camel<FeedbackDraft>(d) };
  }
  async markReviewed(draftId: string, expectedVersion: number, audienceHash: string) {
    await this.rpc('coach_mark_reviewed', { p_draft_id: draftId, p_expected_version: expectedVersion, p_confirmed_audience_hash: audienceHash });
    const { data } = await this.client.from('feedback_drafts').select('*').eq('id', draftId).single();
    return camel<FeedbackDraft>(data);
  }
  async publishFeedback(input: { draftId: string; draftVersion: number; confirmedAudienceHash: string; idempotencyKey: string }) {
    const r = await this.rpc<{ publication_id: string; duplicate: boolean }>('publish_feedback', { p_draft_id: input.draftId, p_draft_version: input.draftVersion, p_confirmed_audience_hash: input.confirmedAudienceHash, p_idempotency_key: input.idempotencyKey });
    return { publicationId: r.publication_id, duplicate: r.duplicate };
  }
  async declineRequest(requestId: string) {
    await this.rpc('decline_loop_request', { p_request_id: requestId });
  }
  async createBrief(input: { athleteId: string; guardianLinkId: string; somethingToSay: string; questionToAsk: string; habitToPraise: string; sourceIds: string[] }) {
    const r = await this.rpc<{ brief_id: string }>('coach_create_brief', { p_athlete_id: input.athleteId, p_guardian_link_id: input.guardianLinkId || null, p_something_to_say: input.somethingToSay, p_question_to_ask: input.questionToAsk, p_habit_to_praise: input.habitToPraise, p_source_ids: input.sourceIds });
    return { briefId: r.brief_id };
  }
  async advanceBrief(briefId: string, action: 'review' | 'publish' | 'revoke') {
    await this.rpc('coach_advance_brief', { p_brief_id: briefId, p_action: action });
  }
  async getTeamCoverage(): Promise<TeamCoverageCell[]> {
    throw new DomainError('feature_disabled', 'Team tools are a P1 feature behind a disabled flag.');
  }

  // ------------------------------------------------------------------ settings
  async getSettings(): Promise<SettingsView> {
    const uid = await this.uid();
    const athleteId = await this.myAthleteId();
    const [prefs, consents, notes, audit, del, shares] = await Promise.all([
      this.client.from('notification_preferences').select('*').eq('user_id', uid).maybeSingle(),
      this.client.from('consent_records').select('*'),
      this.client.from('notification_jobs').select('*').order('created_at', { ascending: false }).limit(50),
      this.client.from('audit_events').select('*').order('created_at', { ascending: false }).limit(50),
      this.client.from('deletion_requests').select('*'),
      this.client.from('sharing_grants').select('*').eq('owner_athlete_id', athleteId ?? '00000000-0000-0000-0000-000000000000'),
    ]);
    const shareRows = camel<SharingGrant[]>(shares.data ?? []);
    await this.names(shareRows.map((s) => s.recipientUserId));
    const p = camel<SettingsView['prefs'] & { inAppEnabled: boolean }>(prefs.data ?? {});
    return {
      prefs: { ...p, userId: uid, smsReminders: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      consents: camel(consents.data ?? []),
      notifications: camel(notes.data ?? []),
      myAudit: camel(audit.data ?? []),
      deletionRequests: camel(del.data ?? []),
      shares: shareRows.map((s) => ({ ...s, recipientName: this.nameCache.get(s.recipientUserId) ?? '' })),
      entitlement: athleteId ? camel(await this.rpc('my_entitlement', { p_athlete_id: athleteId })) : null,
    };
  }
  async updatePreferences(input: { inAppEnabled: boolean; emailReminders: boolean; quietHoursStart: number; quietHoursEnd: number }) {
    await this.rpc('update_notification_preferences', { p_in_app: input.inAppEnabled, p_email_reminders: input.emailReminders, p_quiet_start: input.quietHoursStart, p_quiet_end: input.quietHoursEnd });
  }
  async markNotificationRead(id: string) {
    await this.rpc('mark_notification_read', { p_id: id });
  }
  async exportMyData() {
    return this.rpc<Record<string, unknown>>('export_my_data');
  }
  async requestDeletion(scope: 'account' | 'voice_only' | 'reflections') {
    await this.rpc('request_deletion', { p_scope: scope });
  }
  async reportConcern(input: { description: string; subjectAthleteId: string | null; referenceType: Concern['referenceType'] | null; referenceId: string | null }) {
    const r = await this.rpc<{ routed: boolean }>('report_concern', { p_description: input.description, p_subject_athlete_id: input.subjectAthleteId, p_reference_type: input.referenceType, p_reference_id: input.referenceId });
    return { routed: r.routed };
  }
  async blockUser(userId: string) {
    await this.rpc('block_user', { p_user_id: userId });
  }

  // ------------------------------------------------------------------ admin
  async getAdmin(): Promise<AdminView> {
    const v = await this.getViewer();
    const canReview = !!v?.staffRoles.includes('verification_reviewer') && v.aal === 'aal2';
    const canSafeguard = !!v?.staffRoles.includes('safeguarding_owner') && v.aal === 'aal2';
    if (!v?.staffRoles.length) throw new DomainError('forbidden', 'Staff role required.');
    if (v.aal !== 'aal2') throw new DomainError('forbidden', 'Verify your second factor (MFA) to open admin tools.');
    const queue = canReview ? await this.rpc<Row[]>('verification_queue') : [];
    await this.names(queue.map((q) => q.subject_user_id as string));
    const [{ data: concerns }, { data: audit }] = await Promise.all([
      this.client.from('concerns').select('*').order('created_at', { ascending: false }),
      this.client.from('audit_events').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    return {
      canReview,
      canSafeguard,
      queue: queue.map((q) => ({ kind: q.kind as 'coach' | 'guardian', id: q.id as string, athleteRef: shortRef(q.athlete_id as string), subjectName: this.nameCache.get(q.subject_user_id as string) ?? 'Unknown', state: q.state as string, guardianApproved: (q.guardian_approved as boolean | null) ?? null, createdAt: q.created_at as string })),
      concerns: camel(concerns ?? []),
      audit: camel(audit ?? []),
    };
  }
  async reviewCoach(relationshipId: string, decision: 'verify' | 'reject' | 'suspend' | 'reinstate', evidenceRef: string) {
    await this.rpc('review_coach_relationship', { p_rel_id: relationshipId, p_decision: decision, p_evidence_ref: evidenceRef });
  }
  async reviewGuardianLink(linkId: string, decision: 'verify' | 'reject', evidenceRef: string) {
    await this.rpc('review_guardian_link', { p_link_id: linkId, p_decision: decision, p_evidence_ref: evidenceRef });
  }
  async triageConcern(concernId: string, state: Concern['state'], severity: Concern['severity']) {
    await this.rpc('triage_concern', { p_concern_id: concernId, p_state: state, p_severity: severity, p_evidence_ref: null });
  }
}
