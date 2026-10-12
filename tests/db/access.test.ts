import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, expectDenied, expectLoopError, rpc, select, superuser, createAuthUser } from './harness';
import type { Db } from './harness';
import { buildWorld, key, POLICY, registerAthlete, submitReflection, openRequest } from './fixtures';
import type { World } from './fixtures';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db?.close());

const TABLES = ['profiles', 'athletes', 'reflections', 'loop_requests', 'feedback_drafts', 'feedback_publications', 'coach_notes',
  'parent_briefs', 'guardian_links', 'consent_records', 'audit_events', 'concerns', 'voice_assets', 'subscriptions', 'processed_stripe_events',
  'rate_limits', 'ai_usage', 'app_settings'];

describe('deny by default', () => {
  it('every public table has RLS enabled', async () => {
    const rows = await superuser<{ relname: string }>(db, `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
  it('anonymous users cannot read any table or call any RPC', async () => {
    for (const t of TABLES) await expectDenied(select(db, { id: null }, `select * from public.${t}`));
    await expectDenied(rpc(db, { id: null }, 'export_my_data'));
    await expectDenied(rpc(db, { id: null }, 'redeem_coach_invite', { p_token: 'x' }));
  });
  it('authenticated users cannot write tables directly (writes go through checked RPCs)', async () => {
    await expectDenied(as(db, w.adult, (c) => c.query(`insert into public.reflections (athlete_id, prompt_version_id, author_id) values ($1, gen_random_uuid(), $2)`, [w.adult.athleteId, w.adult.id])));
    await expectDenied(as(db, w.adult, (c) => c.query(`update public.profiles set account_state = 'active' where id = $1`, [w.adult.id])));
    await expectDenied(as(db, w.coach, (c) => c.query(`update public.coach_relationships set verification_state = 'verified'`)));
    await expectDenied(as(db, w.adult, (c) => c.query(`delete from public.audit_events`)));
  });
  it('service-only functions are not callable by users', async () => {
    await expectDenied(rpc(db, w.adult, 'expire_due_requests'));
    await expectDenied(rpc(db, w.adult, 'process_deletion', { p_request_id: crypto.randomUUID() }));
    await expectDenied(rpc(db, w.adult, 'billing_record_event', { p_event_id: 'evt_x', p_type: 'invoice.paid' }));
  });
  it('invite token and email hashes are never selectable', async () => {
    await expectDenied(select(db, w.minor, `select token_hash from public.coach_invites`));
    await expectDenied(select(db, w.minor, `select intended_email_hash from public.guardian_invites`));
    const rows = await select(db, w.minor, `select id, intended_email_hint from public.coach_invites`);
    expect(rows.length).toBeGreaterThan(0);
  });
  it('profiles are not a directory and contain no email', async () => {
    const cols = await superuser<{ column_name: string }>(db, `select column_name from information_schema.columns where table_schema='public' and table_name='profiles'`);
    expect(cols.map((c) => c.column_name)).not.toContain('email');
    const seen = await select<{ id: string }>(db, w.outsider, `select id from public.profiles`);
    expect(seen.map((r) => r.id)).toEqual([w.outsider.id]);
  });
});

describe('pending minor and adult activation', () => {
  it('adult athlete activates on verified signup + privacy notice and can reflect without a team', async () => {
    const id = await submitReflection(db, w.adult);
    const rows = await select(db, w.adult, `select mood, state from public.reflections where id = $1`, [id]);
    expect(rows[0]).toEqual({ mood: null, state: 'submitted' }); // missing mood stays null
    expect(await select(db, w.adult, `select * from public.memberships`)).toEqual([]);
  });
  it('pending minor cannot store diary, audio or sessions before guardian activation', async () => {
    const pending = await registerAthlete(db, 'new.minor@athlete.test', 'Nia', '13_17');
    expect(pending.accountState).toBe('pending_guardian');
    await expectLoopError(rpc(db, pending, 'save_reflection_draft', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'x', p_answer_moment_back: '', p_support_request: null, p_mood: null }), 'account_not_active');
    await expectLoopError(rpc(db, pending, 'submit_reflection', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'x', p_answer_moment_back: 'y', p_support_request: null, p_mood: null, p_idempotency_key: key() }), 'account_not_active');
    await expectLoopError(rpc(db, pending, 'create_personal_session', { p_title: 'x', p_sport: null, p_starts_at: new Date().toISOString(), p_timezone: 'UTC' }), 'account_not_active');
    await rpc(db, pending, 'record_consent', { p_purpose: 'voice_recording', p_policy_version: POLICY });
    await expectDenied(as(db, pending, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('voice', $1)`, [`${pending.id}/a.webm`])));
    await expectLoopError(rpc(db, pending, 'create_coach_invite', { p_coach_name: 'C', p_coach_email: 'c@x.test' }), 'account_not_active');
    // Guardian invite is the one thing a pending shell can do.
    const inv = await rpc<{ token: string }>(db, pending, 'create_guardian_invite', { p_guardian_email: 'nia.parent@family.test' });
    expect(inv.token.length).toBeGreaterThanOrEqual(43);
  });
  it('a guardian link alone does not activate; consent and assent are both required', async () => {
    const m = await registerAthlete(db, 'tia@athlete.test', 'Tia', '13_17');
    const g = await createAuthUser(db, 'tia.parent@family.test');
    await rpc(db, g, 'register_profile', { p_display_name: 'Tia parent', p_eligibility_band: '18_plus', p_timezone: 'UTC', p_as_athlete: false, p_privacy_policy_version: POLICY });
    const inv = await rpc<{ token: string }>(db, m, 'create_guardian_invite', { p_guardian_email: g.email });
    const link = await rpc<{ link_id: string }>(db, g, 'redeem_guardian_invite', { p_token: inv.token });
    // Consent before human verification is refused.
    await expectLoopError(rpc(db, g, 'record_consent', { p_purpose: 'guardian_consent', p_policy_version: POLICY, p_athlete_id: m.athleteId }), 'forbidden');
    await rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_guardian_link', { p_link_id: link.link_id, p_decision: 'verify', p_evidence_ref: 'ev' });
    const c = await rpc<{ account_state: string }>(db, g, 'record_consent', { p_purpose: 'guardian_consent', p_policy_version: POLICY, p_athlete_id: m.athleteId });
    expect(c.account_state).toBe('pending_guardian');
    const a = await rpc<{ account_state: string }>(db, m, 'record_consent', { p_purpose: 'athlete_assent', p_policy_version: POLICY });
    expect(a.account_state).toBe('active');
  });
  it('under-13 stays pending even with full consent (requires owner/legal review)', async () => {
    const kid = await registerAthlete(db, 'kid@athlete.test', 'Kid', 'under_13');
    const g = await createAuthUser(db, 'kid.parent@family.test');
    await rpc(db, g, 'register_profile', { p_display_name: 'Kid parent', p_eligibility_band: '18_plus', p_timezone: 'UTC', p_as_athlete: false, p_privacy_policy_version: POLICY });
    const inv = await rpc<{ token: string }>(db, kid, 'create_guardian_invite', { p_guardian_email: g.email });
    const link = await rpc<{ link_id: string }>(db, g, 'redeem_guardian_invite', { p_token: inv.token });
    await rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_guardian_link', { p_link_id: link.link_id, p_decision: 'verify', p_evidence_ref: 'ev' });
    await rpc(db, g, 'record_consent', { p_purpose: 'guardian_consent', p_policy_version: POLICY, p_athlete_id: kid.athleteId });
    const a = await rpc<{ account_state: string }>(db, kid, 'record_consent', { p_purpose: 'athlete_assent', p_policy_version: POLICY });
    expect(a.account_state).toBe('pending_guardian');
  });
  it('unverified email cannot register or redeem', async () => {
    const u = await createAuthUser(db, 'unverified@x.test', false);
    await expectLoopError(rpc(db, u, 'register_profile', { p_display_name: 'U', p_eligibility_band: '18_plus', p_timezone: 'UTC', p_as_athlete: false, p_privacy_policy_version: POLICY }), 'unauthorized');
  });
  it('minors cannot register as guardian/coach', async () => {
    const u = await createAuthUser(db, 'teen.coach@x.test');
    await expectLoopError(rpc(db, u, 'register_profile', { p_display_name: 'T', p_eligibility_band: '13_17', p_timezone: 'UTC', p_as_athlete: false, p_privacy_policy_version: POLICY }), 'forbidden');
  });
});

describe('identity and isolation', () => {
  it('two athletes named Ava never share identity: attribution is by UUID', async () => {
    expect(w.adult.athleteId).not.toBe(w.minorTwin.athleteId);
    const r1 = await submitReflection(db, w.minorTwin, 'Twin well', 'Twin back');
    const adultSees = await select<{ id: string }>(db, w.adult, `select id from public.reflections`);
    expect(adultSees.map((r) => r.id)).not.toContain(r1);
    const names = await select<{ display_name: string }>(db, w.adult, `select display_name from public.profiles where display_name = 'Ava'`);
    expect(names).toHaveLength(1);
  });
  it('cross-user reads and guessed IDs are denied for reflections', async () => {
    const r = await submitReflection(db, w.minor);
    for (const actor of [w.adult, w.outsider, w.guardian, w.otherGuardian, w.coach, w.pendingCoach]) {
      expect(await select(db, actor, `select * from public.reflections where id = $1`, [r])).toEqual([]);
    }
    // Using someone else's reflection id in an RPC fails.
    await expectLoopError(rpc(db, w.adult, 'revise_reflection', { p_reflection_id: r, p_answer_well: 'x', p_answer_moment_back: 'y', p_support_request: null, p_mood: null, p_idempotency_key: key() }), 'not_found');
  });
  it('pending coach sees no request content, even by guessed id', async () => {
    const reflection = await submitReflection(db, w.minor);
    // The pending coach relationship cannot be used for a request at all.
    const prev = await rpc<{ hash: string; gate_failures: string[] }>(db, w.minor, 'preview_exchange_audience', { p_rel_id: w.pendingCoach.relId });
    expect(prev.gate_failures).toContain('coach_not_verified');
    await expectLoopError(rpc(db, w.minor, 'create_loop_request', { p_reflection_id: reflection, p_rel_id: w.pendingCoach.relId, p_shared_excerpt: 'x', p_question: 'y', p_confirmed_audience_hash: prev.hash, p_idempotency_key: key() }), 'coach_not_verified');
    const req = await openRequest(db, w.minor, w.coach.relId, reflection);
    expect(await select(db, w.pendingCoach, `select * from public.loop_requests where id = $1`, [req.request_id])).toEqual([]);
    expect(await select(db, w.pendingCoach, `select * from public.athletes`)).toEqual([]);
    await expectLoopError(rpc(db, w.pendingCoach, 'coach_save_draft', { p_request_id: req.request_id, p_summary: 's', p_one_next_action: 'a', p_situation: 's', p_measure: 'm' }), 'not_found');
    await expectLoopError(rpc(db, w.pendingCoach, 'coach_ai_sources', { p_request_id: req.request_id }), 'not_found');
    // Unrelated verified coach (of another athlete) is also denied.
    expect(await select(db, w.adultCoach, `select * from public.loop_requests where id = $1`, [req.request_id])).toEqual([]);
    await rpc(db, w.minor, 'cancel_loop_request', { p_request_id: req.request_id });
  });
  it('unlinked guardian sees nothing about another family', async () => {
    for (const t of ['reflections', 'loop_requests', 'feedback_publications', 'parent_briefs', 'focus_versions']) {
      const rows = await select<{ athlete_id: string }>(db, w.otherGuardian, `select athlete_id from public.${t}`);
      expect(rows.every((r) => r.athlete_id !== w.minor.athleteId)).toBe(true);
    }
  });
  it('cross-team and cross-club access is denied', async () => {
    const [club1, club2] = await superuser<{ id: string; tenant_id: string }>(db, `insert into public.clubs (name) values ('Club One'), ('Club Two') returning id, tenant_id`);
    const [team1] = await superuser<{ id: string }>(db, `insert into public.teams (tenant_id, club_id, name) values ($1, $2, 'U15') returning id`, [club1!.tenant_id, club1!.id]);
    const [team2] = await superuser<{ id: string }>(db, `insert into public.teams (tenant_id, club_id, name) values ($1, $2, 'U15') returning id`, [club2!.tenant_id, club2!.id]);
    await superuser(db, `insert into public.memberships (tenant_id, team_id, user_id, role) values ($1, $2, $3, 'coach')`, [club1!.tenant_id, team1!.id, w.coach.id]);
    await superuser(db, `insert into public.activity_sessions (team_id, tenant_id, title, starts_at, author_id) values ($1, $2, 'Practice', now(), $3), ($4, $5, 'Practice', now(), $3)`, [team1!.id, club1!.tenant_id, w.coach.id, team2!.id, club2!.tenant_id]);
    const sessions = await select<{ team_id: string }>(db, w.coach, `select team_id from public.activity_sessions where team_id is not null`);
    expect(sessions.map((s) => s.team_id)).toEqual([team1!.id]);
    expect((await select<{ id: string }>(db, w.coach, `select id from public.clubs`)).map((c) => c.id)).toEqual([club1!.id]);
    expect(await select(db, w.coach, `select * from public.teams where id = $1`, [team2!.id])).toEqual([]);
    // Composite FK prevents a membership that mixes one club's tenant with another club's team.
    await expect(superuser(db, `insert into public.memberships (tenant_id, team_id, user_id, role) values ($1, $2, $3, 'coach')`, [club1!.tenant_id, team2!.id, w.coach.id])).rejects.toThrow(/foreign key/);
  });
});

describe('coach invitations and verification', () => {
  it('rejects replay, expiry, revocation, email mismatch and forged tokens', async () => {
    const coach2 = await createAuthUser(db, 'jo@coach.test');
    await rpc(db, coach2, 'register_profile', { p_display_name: 'Coach Jo', p_eligibility_band: '18_plus', p_timezone: 'UTC', p_as_athlete: false, p_privacy_policy_version: POLICY });
    const wrong = await createAuthUser(db, 'not.jo@coach.test');
    await rpc(db, wrong, 'register_profile', { p_display_name: 'Not Jo', p_eligibility_band: '18_plus', p_timezone: 'UTC', p_as_athlete: false, p_privacy_policy_version: POLICY });

    const inv = await rpc<{ token: string; invite_id: string }>(db, w.adult, 'create_coach_invite', { p_coach_name: 'Coach Jo', p_coach_email: 'JO@coach.test' });
    await expectLoopError(rpc(db, wrong, 'redeem_coach_invite', { p_token: inv.token }), 'invite_invalid').then((m) => expect(m).toMatch(/email_mismatch/));
    await expectLoopError(rpc(db, coach2, 'redeem_coach_invite', { p_token: inv.token + 'x' }), 'invite_invalid');
    await rpc(db, coach2, 'redeem_coach_invite', { p_token: inv.token });
    await expectLoopError(rpc(db, coach2, 'redeem_coach_invite', { p_token: inv.token }), 'invite_invalid').then((m) => expect(m).toMatch(/already_redeemed/));

    const inv2 = await rpc<{ token: string; invite_id: string }>(db, w.adult, 'create_coach_invite', { p_coach_name: 'Coach Jo', p_coach_email: 'jo@coach.test' });
    await rpc(db, w.adult, 'revoke_coach_invite', { p_invite_id: inv2.invite_id });
    await expectLoopError(rpc(db, coach2, 'redeem_coach_invite', { p_token: inv2.token }), 'invite_invalid').then((m) => expect(m).toMatch(/revoked/));

    const inv3 = await rpc<{ token: string; invite_id: string }>(db, w.adult, 'create_coach_invite', { p_coach_name: 'Coach Jo', p_coach_email: 'jo@coach.test' });
    await superuser(db, `update public.coach_invites set created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where id = $1`, [inv3.invite_id]);
    await expectLoopError(rpc(db, coach2, 'redeem_coach_invite', { p_token: inv3.token }), 'invite_invalid').then((m) => expect(m).toMatch(/expired/));
  });
  it('invite creation is rate limited', async () => {
    const a = await registerAthlete(db, 'rl@athlete.test', 'RL', '18_plus');
    for (let i = 0; i < 5; i++) await rpc(db, a, 'create_coach_invite', { p_coach_name: 'C', p_coach_email: `c${i}@x.test` });
    await expectLoopError(rpc(db, a, 'create_coach_invite', { p_coach_name: 'C', p_coach_email: 'c9@x.test' }), 'rate_limited');
  });
  it('forged verification fails: non-reviewers, reviewers without MFA, self-verification', async () => {
    await expectLoopError(rpc(db, w.pendingCoach, 'review_coach_relationship', { p_rel_id: w.pendingCoach.relId, p_decision: 'verify', p_evidence_ref: 'me' }), 'forbidden');
    await expectLoopError(rpc(db, w.minor, 'review_coach_relationship', { p_rel_id: w.pendingCoach.relId, p_decision: 'verify', p_evidence_ref: 'me' }), 'forbidden');
    await expectLoopError(rpc(db, { ...w.reviewer, aal: 'aal1' }, 'review_coach_relationship', { p_rel_id: w.pendingCoach.relId, p_decision: 'verify', p_evidence_ref: 'x' }), 'forbidden');
    // Minor's coach needs guardian approval before verification.
    await expectLoopError(rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: w.pendingCoach.relId, p_decision: 'verify', p_evidence_ref: 'x' }), 'validation');
    await expectLoopError(rpc(db, w.otherGuardian, 'guardian_approve_coach', { p_rel_id: w.pendingCoach.relId }), 'forbidden');
    // Evidence reference is mandatory.
    await expectLoopError(rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: w.pendingCoach.relId, p_decision: 'verify', p_evidence_ref: ' ' }), 'validation');
    const rows = await select<{ verification_state: string }>(db, w.minor, `select verification_state from public.coach_relationships where id = $1`, [w.pendingCoach.relId]);
    expect(rows[0]?.verification_state).toBe('identity_pending');
  });
  it('verification queue exposes metadata only and needs MFA', async () => {
    await expectLoopError(rpc(db, { ...w.reviewer, aal: 'aal1' }, 'verification_queue'), 'forbidden');
    const q = await select<Record<string, unknown>>(db, { ...w.reviewer, aal: 'aal2' }, `select * from public.verification_queue()`);
    expect(q.length).toBeGreaterThan(0);
    expect(Object.keys(q[0]!).sort()).toEqual(['athlete_id', 'created_at', 'guardian_approved', 'id', 'kind', 'state', 'subject_user_id']);
  });
});

describe('storage (private voice bucket)', () => {
  it('owner with voice consent can upload to own folder; others cannot read or write it', async () => {
    await rpc(db, w.adult, 'record_consent', { p_purpose: 'voice_recording', p_policy_version: POLICY });
    await as(db, w.adult, (c) => c.query(`insert into storage.objects (bucket_id, name, owner) values ('voice', $1, $2)`, [`${w.adult.id}/r1.webm`, w.adult.id]));
    await expectDenied(as(db, w.adult, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('voice', $1)`, [`${w.minor.id}/evil.webm`])));
    expect(await select(db, w.adultCoach, `select * from storage.objects where bucket_id = 'voice'`)).toEqual([]);
    expect(await select(db, w.outsider, `select * from storage.objects where bucket_id = 'voice'`)).toEqual([]);
    expect((await select(db, w.adult, `select name from storage.objects where bucket_id = 'voice'`)).length).toBe(1);
  });
  it('upload without voice consent is denied', async () => {
    await expectDenied(as(db, w.minor, (c) => c.query(`insert into storage.objects (bucket_id, name) values ('voice', $1)`, [`${w.minor.id}/a.webm`])));
  });
});
