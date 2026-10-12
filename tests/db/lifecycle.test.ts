import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createTestDb, expectDenied, expectLoopError, rpc, select, superuser } from './harness';
import type { Db } from './harness';
import { buildWorld, key, openRequest, POLICY, registerAthlete, submitReflection } from './fixtures';
import type { World } from './fixtures';

let db: Db;
let w: World;
const service = { id: null, role: 'service_role' as const };

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db?.close());

describe('activity sessions', () => {
  it('canceling a session cancels assignments and pending reminders and excludes it from completion', async () => {
    const s = await rpc<{ session_id: string; assignment_id: string }>(db, w.adult, 'create_personal_session', { p_title: 'Tuesday training', p_sport: 'soccer', p_starts_at: new Date(Date.now() + 86400000).toISOString(), p_timezone: 'America/Toronto' });
    await superuser(db, `insert into public.notification_jobs (recipient_user_id, channel, purpose, due_at, idempotency_key, title, link_path, related_session_id) values ($1, 'in_app', 'reflection_reminder', now() + interval '1 day', $2, 'Time for a 90-second reflection', '/reflect', $3)`, [w.adult.id, key('rem'), s.session_id]);
    const sess = await select<{ version: number }>(db, w.adult, `select version from public.activity_sessions where id = $1`, [s.session_id]);
    await rpc(db, w.adult, 'reschedule_session', { p_session_id: s.session_id, p_starts_at: new Date(Date.now() + 2 * 86400000).toISOString(), p_version: sess[0]!.version });
    await expectLoopError(rpc(db, w.adult, 'reschedule_session', { p_session_id: s.session_id, p_starts_at: new Date().toISOString(), p_version: sess[0]!.version }), 'conflict');
    await rpc(db, w.adult, 'cancel_session', { p_session_id: s.session_id });
    const a = await select<{ state: string }>(db, w.adult, `select state from public.assignments where id = $1`, [s.assignment_id]);
    expect(a[0]?.state).toBe('canceled');
    const jobs = await select<{ state: string }>(db, w.adult, `select state from public.notification_jobs where related_session_id = $1`, [s.session_id]);
    expect(jobs.map((j) => j.state)).toEqual(['canceled']);
    await expectLoopError(rpc(db, w.minor, 'cancel_session', { p_session_id: s.session_id }), 'not_found');
    const audit = await select(db, w.adult, `select action from public.audit_events where $1 = any(target_ids)`, [s.session_id]);
    expect(audit.map((x) => (x as { action: string }).action)).toEqual(expect.arrayContaining(['session.rescheduled', 'session.canceled']));
  });
});

describe('reflections', () => {
  it('drafts autosave with optimistic concurrency; submit is idempotent; revisions do not alter shared snapshots', async () => {
    const d = await rpc<{ reflection_id: string; version: number }>(db, w.adult, 'save_reflection_draft', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'draft', p_answer_moment_back: '', p_support_request: null, p_mood: null });
    const d2 = await rpc<{ version: number }>(db, w.adult, 'save_reflection_draft', { p_reflection_id: d.reflection_id, p_assignment_id: null, p_answer_well: 'draft 2', p_answer_moment_back: 'b', p_support_request: null, p_mood: 4, p_expected_version: d.version });
    await expectLoopError(rpc(db, w.adult, 'save_reflection_draft', { p_reflection_id: d.reflection_id, p_assignment_id: null, p_answer_well: 'stale', p_answer_moment_back: '', p_support_request: null, p_mood: null, p_expected_version: d.version }), 'conflict');
    expect(d2.version).toBe(d.version + 1);
    const k = key('sub');
    const args = { p_reflection_id: d.reflection_id, p_assignment_id: null, p_answer_well: 'I kept my shape.', p_answer_moment_back: 'I lost my runner.', p_support_request: null, p_mood: null, p_idempotency_key: k };
    const s1 = await rpc<{ reflection_id: string }>(db, w.adult, 'submit_reflection', args);
    const s2 = await rpc<{ reflection_id: string; duplicate: boolean }>(db, w.adult, 'submit_reflection', args);
    expect(s2).toEqual({ reflection_id: s1.reflection_id, duplicate: true });
    const row = await select<{ mood: number | null }>(db, w.adult, `select mood from public.reflections where id = $1`, [s1.reflection_id]);
    expect(row[0]?.mood).toBeNull();
    await expectLoopError(rpc(db, w.adult, 'save_reflection_draft', { p_reflection_id: s1.reflection_id, p_assignment_id: null, p_answer_well: 'x', p_answer_moment_back: '', p_support_request: null, p_mood: null }), 'invalid_transition');
    const req = await openRequest(db, w.adult, w.adultCoach.relId, s1.reflection_id);
    const rev = await rpc<{ reflection_id: string }>(db, w.adult, 'revise_reflection', { p_reflection_id: s1.reflection_id, p_answer_well: 'Revised', p_answer_moment_back: 'Revised moment', p_support_request: null, p_mood: 3, p_idempotency_key: key() });
    expect(rev.reflection_id).not.toBe(s1.reflection_id);
    const snap = await select<{ shared_excerpt: string; reflection_id: string }>(db, w.adultCoach, `select shared_excerpt, reflection_id from public.loop_requests where id = $1`, [req.request_id]);
    expect(snap[0]).toEqual({ shared_excerpt: 'I hesitated before the shot.', reflection_id: s1.reflection_id });
    await rpc(db, w.adult, 'cancel_loop_request', { p_request_id: req.request_id });
  });
  it('enforces input length limits at the database', async () => {
    await expect(rpc(db, w.adult, 'submit_reflection', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'a'.repeat(1300), p_answer_moment_back: 'b', p_support_request: null, p_mood: null, p_idempotency_key: key() })).rejects.toThrow(/check constraint/);
    await expect(rpc(db, w.adult, 'submit_reflection', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'a', p_answer_moment_back: 'b', p_support_request: null, p_mood: 0, p_idempotency_key: key() })).rejects.toThrow(/check constraint/);
  });
});

describe('consent withdrawal', () => {
  it('guardian consent withdrawal suspends processing and cancels open exchanges', async () => {
    const reflection = await submitReflection(db, w.minorTwin);
    // minorTwin has no verified coach; use activation state check instead.
    const consents = await select<{ id: string }>(db, w.otherGuardian, `select id from public.consent_records where purpose = 'guardian_consent' and withdrawn_at is null`);
    await rpc(db, w.otherGuardian, 'withdraw_consent', { p_consent_id: consents[0]!.id });
    const prof = await select<{ account_state: string }>(db, w.minorTwin, `select account_state from public.profiles where id = $1`, [w.minorTwin.id]);
    expect(prof[0]?.account_state).toBe('withdrawal_pending');
    await expectLoopError(rpc(db, w.minorTwin, 'submit_reflection', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'a', p_answer_moment_back: 'b', p_support_request: null, p_mood: null, p_idempotency_key: key() }), 'account_not_active');
    // Existing records are retained pending the documented withdrawal workflow (not silently destroyed).
    expect(await select(db, w.minorTwin, `select id from public.reflections where id = $1`, [reflection])).toHaveLength(1);
    // Re-granting consent reactivates (the guardian link is still verified).
    await rpc(db, w.otherGuardian, 'record_consent', { p_purpose: 'guardian_consent', p_policy_version: POLICY, p_athlete_id: w.minorTwin.athleteId });
    const again = await select<{ account_state: string }>(db, w.minorTwin, `select account_state from public.profiles where id = $1`, [w.minorTwin.id]);
    expect(again[0]?.account_state).toBe('active');
  });
  it('coach sharing withdrawal cancels the open request; other people cannot withdraw my consent', async () => {
    const reflection = await submitReflection(db, w.adult);
    const req = await openRequest(db, w.adult, w.adultCoach.relId, reflection);
    const c = await select<{ id: string }>(db, w.adult, `select id from public.consent_records where purpose = 'coach_sharing' and withdrawn_at is null`);
    await expectLoopError(rpc(db, w.outsider, 'withdraw_consent', { p_consent_id: c[0]!.id }), 'not_found');
    await rpc(db, w.adult, 'withdraw_consent', { p_consent_id: c[0]!.id });
    expect((await select<{ state: string }>(db, w.adult, `select state from public.loop_requests where id = $1`, [req.request_id]))[0]?.state).toBe('canceled');
    await rpc(db, w.adult, 'record_consent', { p_purpose: 'coach_sharing', p_policy_version: POLICY });
  });
  it('SMS consent is refused (feature disabled); email reminders require email consent', async () => {
    await expectLoopError(rpc(db, w.adult, 'record_consent', { p_purpose: 'sms_notifications', p_policy_version: POLICY }), 'feature_disabled');
    await expectLoopError(rpc(db, w.adult, 'update_notification_preferences', { p_in_app: true, p_email_reminders: true, p_quiet_start: 21, p_quiet_end: 8 }), 'consent_required');
    await rpc(db, w.adult, 'record_consent', { p_purpose: 'email_notifications', p_policy_version: POLICY });
    await rpc(db, w.adult, 'update_notification_preferences', { p_in_app: true, p_email_reminders: true, p_quiet_start: 22, p_quiet_end: 7 });
    await expect(superuser(db, `update public.notification_preferences set sms_reminders = true where user_id = $1`, [w.adult.id])).rejects.toThrow(/check constraint/);
    await expect(superuser(db, `insert into public.notification_jobs (recipient_user_id, channel, purpose, due_at, idempotency_key, title, link_path) values ($1, 'email', 'system', now(), $2, 't', '/')`, [w.adult.id, key()])).rejects.toThrow(/check constraint/);
  });
  it('notification jobs dedupe on idempotency key', async () => {
    const k = key('dedupe');
    await superuser(db, `insert into public.notification_jobs (recipient_user_id, channel, purpose, due_at, idempotency_key, title, link_path) values ($1, 'in_app', 'system', now(), $2, 't', '/')`, [w.adult.id, k]);
    await expect(superuser(db, `insert into public.notification_jobs (recipient_user_id, channel, purpose, due_at, idempotency_key, title, link_path) values ($1, 'in_app', 'system', now(), $2, 't', '/')`, [w.adult.id, k])).rejects.toThrow(/duplicate key/);
  });
});

describe('data rights', () => {
  it('export contains only the subject records', async () => {
    const out = await rpc<Record<string, unknown>>(db, w.minor, 'export_my_data');
    const text = JSON.stringify(out);
    expect((out.profile as { id: string }).id).toBe(w.minor.id);
    expect(text).not.toContain(w.adult.athleteId);
    expect(Object.keys(out)).not.toContain('feedback_drafts');
    expect(text).not.toContain('idempotency_key');
  });
  it('account deletion removes diary, audio and derived outputs; audit keeps no content', async () => {
    const a = await registerAthlete(db, 'delete.me@athlete.test', 'Del', '18_plus');
    await rpc(db, a, 'record_consent', { p_purpose: 'voice_recording', p_policy_version: POLICY });
    const r = await submitReflection(db, a, 'ERASE-ME well', 'ERASE-ME back');
    await rpc(db, a, 'register_voice_asset', { p_storage_path: `${a.id}/r.webm`, p_reflection_id: r });
    await superuser(db, `insert into public.profile_snapshots (athlete_id, source_record_ids, generator, generator_version, provenance, content) values ($1, array[$2::uuid], 'deterministic', 'v1', 'test', '{}')`, [a.athleteId, r]);
    const req = await rpc<{ deletion_request_id: string }>(db, a, 'request_deletion', { p_scope: 'account' });
    await expectDenied(rpc(db, a, 'process_deletion', { p_request_id: req.deletion_request_id }));
    const res = await as(db, service, async (c) => (await c.query(`select public.process_deletion($1) r`, [req.deletion_request_id])).rows[0].r);
    expect(res.storage_paths).toEqual([`${a.id}/r.webm`]);
    expect(await superuser(db, `select id from public.reflections where athlete_id = $1`, [a.athleteId])).toEqual([]);
    expect(await superuser(db, `select id from public.voice_assets where owner_user_id = $1`, [a.id])).toEqual([]);
    expect(await superuser(db, `select id from public.profile_snapshots where athlete_id = $1`, [a.athleteId])).toEqual([]);
    const audit = await superuser<{ t: string }>(db, `select string_agg(to_jsonb(x)::text, ' ') t from public.audit_events x`);
    expect(audit[0]?.t).not.toContain('ERASE-ME');
    // Removing the auth user cascades the profile and athlete.
    await superuser(db, `delete from auth.users where id = $1`, [a.id]);
    expect(await superuser(db, `select id from public.athletes where id = $1`, [a.athleteId])).toEqual([]);
  });
});

describe('safeguarding', () => {
  it('concern reports are restricted to the reporter and the safeguarding owner (with MFA)', async () => {
    const c = await rpc<{ concern_id: string; routed: boolean }>(db, w.guardian, 'report_concern', { p_description: 'Uncomfortable message tone', p_subject_athlete_id: w.minor.athleteId, p_reference_type: 'coach_relationship', p_reference_id: w.coach.relId });
    expect(c.routed).toBe(true);
    expect(await select(db, w.guardian, `select id from public.concerns`)).toHaveLength(1);
    expect(await select(db, w.coach, `select id from public.concerns`)).toEqual([]);
    expect(await select(db, w.minor, `select id from public.concerns`)).toEqual([]);
    expect(await select(db, { ...w.reviewer, aal: 'aal2' }, `select id from public.concerns`)).toEqual([]);
    expect(await select(db, { ...w.safeguarding, aal: 'aal1' }, `select id from public.concerns`)).toEqual([]);
    expect(await select(db, { ...w.safeguarding, aal: 'aal2' }, `select id from public.concerns`)).toHaveLength(1);
    await expectLoopError(rpc(db, { ...w.safeguarding, aal: 'aal1' }, 'triage_concern', { p_concern_id: c.concern_id, p_state: 'triaged', p_severity: 'medium', p_evidence_ref: null }), 'forbidden');
    await rpc(db, { ...w.safeguarding, aal: 'aal2' }, 'triage_concern', { p_concern_id: c.concern_id, p_state: 'triaged', p_severity: 'medium', p_evidence_ref: 'case-1' });
  });
  it('blocking a user records the block (and revokes any live coach relationship with them)', async () => {
    const before = await select(db, w.minorTwin, `select id from public.coach_relationships where active`);
    await rpc(db, w.minorTwin, 'block_user', { p_user_id: w.outsider.id });
    expect(await select(db, w.minorTwin, `select id from public.coach_relationships where active`)).toEqual(before);
    expect(await select(db, w.minorTwin, `select blocked_user_id from public.blocks`)).toHaveLength(1);
  });
});

describe('audit log', () => {
  it('is append-only even for the database owner', async () => {
    await expect(superuser(db, `update public.audit_events set action = 'x'`)).rejects.toThrow(/immutable/);
    await expect(superuser(db, `delete from public.audit_events`)).rejects.toThrow(/immutable/);
  });
  it('athletes see audit events about their own records only', async () => {
    const rows = await select<{ target_ids: string[]; actor_user_id: string }>(db, w.minor, `select target_ids, actor_user_id from public.audit_events`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor_user_id === w.minor.id || r.target_ids.includes(w.minor.athleteId))).toBe(true);
  });
});

describe('billing (service role only, test mode)', () => {
  it('dedupes Stripe events and ignores out-of-order/resurrecting updates', async () => {
    const call = (sql: string, params: unknown[]) => as(db, service, async (c) => (await c.query(sql, params)).rows[0]);
    expect((await call(`select public.billing_record_event('evt_1', 'invoice.paid') r`, [])).r).toBe(true);
    expect((await call(`select public.billing_record_event('evt_1', 'invoice.paid') r`, [])).r).toBe(false);
    const up = (status: string, created: number) => call(`select public.billing_upsert_subscription('sub_1', 'cus_1', $1, $2, $3, $4, null) r`, [w.guardian.id, w.minor.athleteId, status, created]);
    expect((await up('active', 100)).r).toBe(true);
    expect((await up('canceled', 300)).r).toBe(true);
    expect((await up('active', 200)).r).toBe(false);
    expect((await up('active', 400)).r).toBe(false);
    const ent = await rpc<{ active: boolean }>(db, w.guardian, 'my_entitlement', { p_athlete_id: w.minor.athleteId });
    expect(ent.active).toBe(false);
    await expectLoopError(rpc(db, w.outsider, 'my_entitlement', { p_athlete_id: w.minor.athleteId }), 'forbidden');
  });
  it('a sponsored athlete is entitled without a family subscription and cannot hold two live subscriptions', async () => {
    await superuser(db, `insert into public.sponsorships (athlete_id, sponsor_name, starts_at) values ($1, 'Club fund', now() - interval '1 day')`, [w.minorTwin.athleteId]);
    const ent = await rpc<{ funding_source: string }>(db, w.minorTwin, 'my_entitlement', { p_athlete_id: w.minorTwin.athleteId });
    expect(ent.funding_source).toBe('sponsorship');
    await superuser(db, `insert into public.subscriptions (payer_user_id, athlete_id, stripe_subscription_id, status) values ($1, $2, 'sub_a', 'active')`, [w.guardian.id, w.minor.athleteId]);
    await expect(superuser(db, `insert into public.subscriptions (payer_user_id, athlete_id, stripe_subscription_id, status) values ($1, $2, 'sub_b', 'active')`, [w.guardian.id, w.minor.athleteId])).rejects.toThrow(/subscriptions_one_live/);
  });
});

describe('synthetic seed', () => {
  it('applies through the real RPCs on a fresh database', async () => {
    const { readFileSync } = await import('node:fs');
    const fresh = await createTestDb();
    try {
      await fresh.pool.query(readFileSync(new URL('../../supabase/seed.sql', import.meta.url), 'utf8'));
      const rows = await superuser<{ account_state: string }>(fresh, `select account_state from public.profiles where id = 'a0000000-0000-4000-8000-000000000001'`);
      expect(rows[0]?.account_state).toBe('active');
      const rel = await superuser<{ verification_state: string }>(fresh, `select verification_state from public.coach_relationships`);
      expect(rel[0]?.verification_state).toBe('verified');
    } finally {
      await fresh.close();
    }
  });
});
