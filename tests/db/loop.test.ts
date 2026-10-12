import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { as, createTestDb, createAuthUser, expectLoopError, rpc, select, superuser } from './harness';
import type { Actor, Db } from './harness';
import { buildWorld, inviteCoach, key, linkGuardian, openRequest, POLICY, registerAdult, submitReflection } from './fixtures';
import type { World } from './fixtures';

let db: Db;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await buildWorld(db);
});
afterAll(async () => db?.close());

async function draftAndReview(coach: Actor, requestId: string, relId: string) {
  const d = await rpc<{ draft_id: string; version: number }>(db, coach, 'coach_save_draft', {
    p_request_id: requestId, p_summary: 'You read the moment honestly.', p_one_next_action: 'Shoot within two touches',
    p_situation: 'When you receive at the edge of the box', p_measure: '3 first-time attempts next session',
  });
  const aud = await rpc<{ hash: string }>(db, coach, 'preview_exchange_audience', { p_rel_id: relId });
  const r = await rpc<{ version: number }>(db, coach, 'coach_mark_reviewed', { p_draft_id: d.draft_id, p_expected_version: d.version, p_confirmed_audience_hash: aud.hash });
  return { draftId: d.draft_id, version: r.version, hash: aud.hash };
}

describe('one active request per athlete', () => {
  it('concurrent requests to different coaches create exactly one active request', async () => {
    // Give the adult athlete a second verified coach.
    const coach2 = await registerAdult(db, 'second.coach@coach.test', 'Coach Two');
    const rel2 = await inviteCoach(db, w.adult, coach2, 'Coach Two');
    await rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: rel2, p_decision: 'verify', p_evidence_ref: 'ev' });
    const reflection = await submitReflection(db, w.adult);
    const h1 = (await rpc<{ hash: string }>(db, w.adult, 'preview_exchange_audience', { p_rel_id: w.adultCoach.relId })).hash;
    const h2 = (await rpc<{ hash: string }>(db, w.adult, 'preview_exchange_audience', { p_rel_id: rel2 })).hash;

    // Two genuinely concurrent transactions, both in-flight before either commits.
    const c1 = await db.pool.connect();
    const c2 = await db.pool.connect();
    const start = async (c: pg.PoolClient) => {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: w.adult.id, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    };
    await start(c1);
    await start(c2);
    const call = (c: pg.PoolClient, rel: string, hash: string) =>
      c.query(`select public.create_loop_request(p_reflection_id => $1, p_rel_id => $2, p_shared_excerpt => 'x', p_question => 'y', p_confirmed_audience_hash => $3, p_idempotency_key => $4)`, [reflection, rel, hash, key()])
        .then(async () => { await c.query('commit'); return 'ok'; })
        .catch(async (e: Error) => { await c.query('rollback'); return e.message; });
    const results = await Promise.all([call(c1, w.adultCoach.relId, h1), call(c2, rel2, h2)]);
    c1.release();
    c2.release();
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.find((r) => r !== 'ok')).toMatch(/LOOP:active_request_exists/);
    const active = await superuser(db, `select id from public.loop_requests where athlete_id = $1 and state in ('queued','waiting_for_coach','response_draft')`, [w.adult.athleteId]);
    expect(active).toHaveLength(1);
    await superuser(db, `update public.loop_requests set state = 'canceled' where athlete_id = $1 and state in ('queued','waiting_for_coach','response_draft')`, [w.adult.athleteId]);
  });
  it('idempotent request creation: retry with same key returns the same request', async () => {
    const reflection = await submitReflection(db, w.adult);
    const hash = (await rpc<{ hash: string }>(db, w.adult, 'preview_exchange_audience', { p_rel_id: w.adultCoach.relId })).hash;
    const k = key();
    const args = { p_reflection_id: reflection, p_rel_id: w.adultCoach.relId, p_shared_excerpt: 'x', p_question: 'y', p_confirmed_audience_hash: hash, p_idempotency_key: k };
    const a = await rpc<{ request_id: string }>(db, w.adult, 'create_loop_request', args);
    const b = await rpc<{ request_id: string; duplicate: boolean }>(db, w.adult, 'create_loop_request', args);
    expect(b.request_id).toBe(a.request_id);
    expect(b.duplicate).toBe(true);
    await rpc(db, w.adult, 'cancel_loop_request', { p_request_id: a.request_id });
  });
  it('expiry frees the slot without fabricating closure', async () => {
    const reflection = await submitReflection(db, w.adult);
    const r = await openRequest(db, w.adult, w.adultCoach.relId, reflection);
    await superuser(db, `update public.loop_requests set due_at = now() - interval '1 minute' where id = $1`, [r.request_id]);
    const n = await as(db, { id: null, role: 'service_role' }, async (c) => (await c.query(`select public.expire_due_requests() n`)).rows[0].n);
    expect(n).toBe(1);
    const rows = await select<{ state: string }>(db, w.adult, `select state from public.loop_requests where id = $1`, [r.request_id]);
    expect(rows[0]?.state).toBe('expired');
    expect(await select(db, w.adult, `select * from public.feedback_publications where request_id = $1`, [r.request_id])).toEqual([]);
    const again = await openRequest(db, w.adult, w.adultCoach.relId, reflection);
    await rpc(db, w.adult, 'cancel_loop_request', { p_request_id: again.request_id });
  });
});

describe('Rule of Two for minors', () => {
  it('audience shown before submission includes the linked guardian as second adult', async () => {
    const prev = await rpc<{ members: { userId: string; role: string }[]; gate_failures: string[] }>(db, w.minor, 'preview_exchange_audience', { p_rel_id: w.coach.relId });
    expect(prev.gate_failures).toEqual([]);
    expect(prev.members.map((m) => m.role).sort()).toEqual(['athlete', 'coach', 'second_adult']);
    expect(prev.members.find((m) => m.role === 'second_adult')?.userId).toBe(w.guardian.id);
  });

  it('second adult sees the actual shared request and published response, not the rest of the diary', async () => {
    const shared = await submitReflection(db, w.minor, 'Shared: I tracked my runner.', 'Shared: I hesitated before the shot.');
    const privateOne = await submitReflection(db, w.minor, 'PRIVATE diary entry', 'PRIVATE moment');
    const req = await openRequest(db, w.minor, w.coach.relId, shared);
    const reqRows = await select<{ shared_excerpt: string; question: string }>(db, w.guardian, `select shared_excerpt, question from public.loop_requests where id = $1`, [req.request_id]);
    expect(reqRows).toHaveLength(1);
    expect(await select(db, w.guardian, `select * from public.reflections where id in ($1, $2)`, [shared, privateOne])).toEqual([]);
    // Coach sees the shared snapshot, never the private diary row.
    expect(await select(db, w.coach, `select * from public.reflections where id in ($1, $2)`, [shared, privateOne])).toEqual([]);

    // Coach drafts privately: athlete and guardian cannot see drafts.
    const reviewed = await draftAndReview(w.coach, req.request_id, w.coach.relId);
    expect(await select(db, w.minor, `select * from public.feedback_drafts`)).toEqual([]);
    expect(await select(db, w.guardian, `select * from public.feedback_drafts`)).toEqual([]);
    expect(await select(db, w.minor, `select * from public.feedback_publications where request_id = $1`, [req.request_id])).toEqual([]);

    // Retry-safe publication: same key twice -> one publication.
    const k = key('pub');
    const p1 = await rpc<{ publication_id: string }>(db, w.coach, 'publish_feedback', { p_draft_id: reviewed.draftId, p_draft_version: reviewed.version, p_confirmed_audience_hash: reviewed.hash, p_idempotency_key: k });
    const p2 = await rpc<{ publication_id: string; duplicate: boolean }>(db, w.coach, 'publish_feedback', { p_draft_id: reviewed.draftId, p_draft_version: reviewed.version, p_confirmed_audience_hash: reviewed.hash, p_idempotency_key: k });
    expect(p2.publication_id).toBe(p1.publication_id);
    expect(p2.duplicate).toBe(true);
    await expectLoopError(rpc(db, w.coach, 'publish_feedback', { p_draft_id: reviewed.draftId, p_draft_version: reviewed.version, p_confirmed_audience_hash: reviewed.hash, p_idempotency_key: key('pub') }), 'invalid_transition');
    expect(await superuser(db, `select id from public.feedback_publications where request_id = $1`, [req.request_id])).toHaveLength(1);

    const guardianView = await select<{ one_next_action: string }>(db, w.guardian, `select one_next_action from public.feedback_publications where request_id = $1`, [req.request_id]);
    expect(guardianView[0]?.one_next_action).toBe('Shoot within two touches');
    const athleteView = await select<{ state: string }>(db, w.minor, `select state from public.loop_requests where id = $1`, [req.request_id]);
    expect(athleteView[0]?.state).toBe('published');
    // Notifications are neutral (no content) and audit carries no diary text.
    const notes = await select<{ title: string }>(db, w.guardian, `select title from public.notification_jobs`);
    expect(notes.map((n) => n.title)).toContain('You have new feedback in Loop');
    const audit = await superuser<{ t: string }>(db, `select string_agg(to_jsonb(a)::text, ' ') t from public.audit_events a`);
    expect(audit[0]?.t).not.toMatch(/hesitated|PRIVATE|Shoot within/);

    // Acknowledge -> Loop closed.
    await rpc(db, w.minor, 'acknowledge_feedback', { p_request_id: req.request_id, p_close: false });
    await rpc(db, w.minor, 'acknowledge_feedback', { p_request_id: req.request_id, p_close: true });
    const closed = await select<{ state: string }>(db, w.minor, `select state from public.loop_requests where id = $1`, [req.request_id]);
    expect(closed[0]?.state).toBe('closed');

    // Correction supersedes; history retained; exactly one current.
    await rpc(db, w.coach, 'correct_publication', { p_publication_id: p1.publication_id, p_summary: 'Corrected', p_one_next_action: 'Shoot within two touches', p_situation: 'Edge of the box', p_measure: '3 attempts', p_confirmed_audience_hash: reviewed.hash, p_idempotency_key: key('cor') });
    const pubs = await select<{ is_current: boolean; corrected_from_id: string | null }>(db, w.minor, `select is_current, corrected_from_id from public.feedback_publications where request_id = $1 order by version`, [req.request_id]);
    expect(pubs).toHaveLength(2);
    expect(pubs.map((p) => p.is_current)).toEqual([false, true]);
    expect(pubs[1]?.corrected_from_id).toBe(p1.publication_id);
    await expect(superuser(db, `update public.feedback_publications set summary = 'silent overwrite' where id = $1`, [p1.publication_id])).rejects.toThrow(/immutable/);
  });

  it('changed draft or audience invalidates the old review', async () => {
    const reflection = await submitReflection(db, w.minor);
    const req = await openRequest(db, w.minor, w.coach.relId, reflection);
    const reviewed = await draftAndReview(w.coach, req.request_id, w.coach.relId);
    // Edit after review -> stale.
    await rpc(db, w.coach, 'coach_save_draft', { p_request_id: req.request_id, p_summary: 'edited', p_one_next_action: 'a', p_situation: 'b', p_measure: 'c' });
    await expectLoopError(rpc(db, w.coach, 'publish_feedback', { p_draft_id: reviewed.draftId, p_draft_version: reviewed.version, p_confirmed_audience_hash: reviewed.hash, p_idempotency_key: key() }), 'stale_review');
    // Re-review, then audience changes (a second guardian becomes the second adult) -> stale.
    const again = await draftAndReview(w.coach, req.request_id, w.coach.relId);
    const g2 = await registerAdult(db, 'max.parent2@family.test', 'Robin (guardian)');
    await linkGuardian(db, w.minor, g2, w.reviewer);
    await rpc(db, w.minor, 'set_second_adult', { p_rel_id: w.coach.relId, p_guardian_user_id: g2.id });
    await expectLoopError(rpc(db, w.coach, 'publish_feedback', { p_draft_id: again.draftId, p_draft_version: again.version, p_confirmed_audience_hash: again.hash, p_idempotency_key: key() }), 'stale_review');
    // Non-guardian adults cannot be named second adult.
    await expectLoopError(rpc(db, w.minor, 'set_second_adult', { p_rel_id: w.coach.relId, p_guardian_user_id: w.outsider.id }), 'second_adult_required');
    await rpc(db, w.minor, 'set_second_adult', { p_rel_id: w.coach.relId, p_guardian_user_id: w.guardian.id });
    await rpc(db, w.minor, 'cancel_loop_request', { p_request_id: req.request_id });
  });

  it('without an active second adult, new minor exchanges are blocked and open ones are canceled', async () => {
    // Fresh family so revocation does not affect other tests.
    const kidUser = await createAuthUser(db, 'lu@athlete.test');
    const kid = { ...kidUser, athleteId: (await rpc<{ athlete_id: string }>(db, kidUser, 'register_profile', { p_display_name: 'Lu', p_eligibility_band: '13_17', p_timezone: 'UTC', p_as_athlete: true, p_privacy_policy_version: POLICY })).athlete_id };
    const parent = await registerAdult(db, 'lu.parent@family.test', 'Lu parent');
    const link = await linkGuardian(db, kid, parent, w.reviewer);
    await rpc(db, parent, 'record_consent', { p_purpose: 'guardian_consent', p_policy_version: POLICY, p_athlete_id: kid.athleteId });
    await rpc(db, kid, 'record_consent', { p_purpose: 'athlete_assent', p_policy_version: POLICY });
    await rpc(db, kid, 'record_consent', { p_purpose: 'coach_sharing', p_policy_version: POLICY });
    const coach = await registerAdult(db, 'lu.coach@coach.test', 'Coach Lu');
    const rel = await inviteCoach(db, kid, coach);
    await rpc(db, parent, 'guardian_approve_coach', { p_rel_id: rel });
    await rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: rel, p_decision: 'verify', p_evidence_ref: 'ev' });
    const reflection = await submitReflection(db, kid);
    const req = await openRequest(db, kid, rel, reflection);
    await rpc(db, parent, 'revoke_guardian_link', { p_link_id: link });
    // Open exchange canceled; parent's new reads blocked immediately.
    expect((await select<{ state: string }>(db, kid, `select state from public.loop_requests where id = $1`, [req.request_id]))[0]?.state).toBe('canceled');
    expect(await select(db, parent, `select * from public.loop_requests where id = $1`, [req.request_id])).toEqual([]);
    // Minor enters the withdrawal workflow: no new diary or exchanges.
    await expectLoopError(rpc(db, kid, 'submit_reflection', { p_reflection_id: null, p_assignment_id: null, p_answer_well: 'a', p_answer_moment_back: 'b', p_support_request: null, p_mood: null, p_idempotency_key: key() }), 'account_not_active');
    const prev = await rpc<{ gate_failures: string[] }>(db, kid, 'preview_exchange_audience', { p_rel_id: rel });
    expect(prev.gate_failures).toEqual(expect.arrayContaining(['account_not_active', 'second_adult_missing']));
  });

  it('suspending a coach immediately removes access and cancels open requests', async () => {
    const reflection = await submitReflection(db, w.adult);
    const req = await openRequest(db, w.adult, w.adultCoach.relId, reflection);
    expect(await select(db, w.adultCoach, `select id from public.loop_requests where id = $1`, [req.request_id])).toHaveLength(1);
    await rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: w.adultCoach.relId, p_decision: 'suspend', p_evidence_ref: 'concern-1' });
    expect(await select(db, w.adultCoach, `select id from public.loop_requests where id = $1`, [req.request_id])).toEqual([]);
    expect(await select(db, w.adultCoach, `select * from public.feedback_publications`)).toEqual([]);
    expect((await select<{ state: string }>(db, w.adult, `select state from public.loop_requests where id = $1`, [req.request_id]))[0]?.state).toBe('canceled');
    await rpc(db, { ...w.reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: w.adultCoach.relId, p_decision: 'reinstate', p_evidence_ref: 'cleared-1' });
  });
});

describe('coach-only notes and team transcripts', () => {
  it('never reach athletes or guardians', async () => {
    await superuser(db, `insert into public.coach_notes (coach_id, athlete_id, kind, body) values ($1, $2, 'team_transcript', 'RAW TEAM TRANSCRIPT')`, [w.coach.id, w.minor.athleteId]);
    expect(await select(db, w.minor, `select * from public.coach_notes`)).toEqual([]);
    expect(await select(db, w.guardian, `select * from public.coach_notes`)).toEqual([]);
    expect(await select(db, w.coach, `select * from public.coach_notes`)).toHaveLength(1);
  });
});

describe('focus versions', () => {
  it('coach proposals never silently change NEXT/NORTH STAR; history retained; one current', async () => {
    await rpc(db, w.minor, 'propose_focus', { p_athlete_id: w.minor.athleteId, p_now: 'Hesitating to shoot', p_next_action: 'Shoot early', p_next_situation: 'Edge of box', p_next_measure: '3 shots', p_north_star: 'Be a confident finisher', p_categories: ['technical'], p_source_ids: [], p_change_reason: 'First focus', p_accept: true });
    const coachProposal = await rpc<{ focus_version_id: string; accepted: boolean }>(db, w.coach, 'propose_focus', { p_athlete_id: w.minor.athleteId, p_now: 'x', p_next_action: 'Scan before receiving', p_next_situation: 'Midfield', p_next_measure: '5 scans', p_north_star: 'Coach-chosen star', p_categories: [], p_source_ids: [], p_change_reason: 'Coach suggestion', p_accept: true });
    expect(coachProposal.accepted).toBe(false);
    let current = await select<{ next_action: string; north_star: string }>(db, w.minor, `select next_action, north_star from public.focus_versions where accepted_at is not null and superseded_at is null`);
    expect(current).toEqual([{ next_action: 'Shoot early', north_star: 'Be a confident finisher' }]);
    // Guardian sees only the current approved focus, never pending proposals.
    expect((await select(db, w.guardian, `select id from public.focus_versions`)).length).toBe(1);
    await expectLoopError(rpc(db, w.coach, 'accept_focus_version', { p_focus_version_id: coachProposal.focus_version_id }), 'account_not_active');
    await rpc(db, w.minor, 'accept_focus_version', { p_focus_version_id: coachProposal.focus_version_id });
    current = await select(db, w.minor, `select next_action, north_star from public.focus_versions where accepted_at is not null and superseded_at is null`);
    expect(current).toEqual([{ next_action: 'Scan before receiving', north_star: 'Coach-chosen star' }]);
    expect((await select(db, w.minor, `select id from public.focus_versions`)).length).toBe(2);
    await expect(superuser(db, `update public.focus_versions set superseded_at = null where athlete_id = $1`, [w.minor.athleteId])).rejects.toThrow(/focus_one_current/);
  });
});

describe('parent briefs and sharing grants', () => {
  it('guardian sees only published, reviewed briefs; quotes refused; revocation blocks new reads', async () => {
    await expectLoopError(rpc(db, w.coach, 'coach_create_brief', { p_athlete_id: w.minor.athleteId, p_guardian_link_id: w.guardian.linkId, p_something_to_say: 'He said "I hate this"', p_question_to_ask: 'q', p_habit_to_praise: 'h', p_source_ids: [] }), 'validation');
    await expectLoopError(rpc(db, w.pendingCoach, 'coach_create_brief', { p_athlete_id: w.minor.athleteId, p_guardian_link_id: w.guardian.linkId, p_something_to_say: 's', p_question_to_ask: 'q', p_habit_to_praise: 'h', p_source_ids: [] }), 'forbidden');
    // Coaches cannot read guardian links: a null link resolves server-side to the second adult's active link.
    const b = await rpc<{ brief_id: string }>(db, w.coach, 'coach_create_brief', { p_athlete_id: w.minor.athleteId, p_guardian_link_id: null, p_something_to_say: 'Notice the effort on early shots.', p_question_to_ask: 'What felt good about shooting today?', p_habit_to_praise: 'Asking for feedback', p_source_ids: [] });
    expect(await select(db, w.guardian, `select * from public.parent_briefs where id = $1`, [b.brief_id])).toEqual([]);
    expect(await select(db, w.coach, `select id from public.guardian_links`)).toEqual([]);
    await expectLoopError(rpc(db, w.coach, 'coach_advance_brief', { p_brief_id: b.brief_id, p_action: 'publish' }), 'invalid_transition');
    await rpc(db, w.coach, 'coach_advance_brief', { p_brief_id: b.brief_id, p_action: 'review' });
    await rpc(db, w.coach, 'coach_advance_brief', { p_brief_id: b.brief_id, p_action: 'publish' });
    expect(await select(db, w.guardian, `select something_to_say from public.parent_briefs where id = $1`, [b.brief_id])).toHaveLength(1);
    expect(await select(db, w.otherGuardian, `select * from public.parent_briefs where id = $1`, [b.brief_id])).toEqual([]);
    await rpc(db, w.coach, 'coach_advance_brief', { p_brief_id: b.brief_id, p_action: 'revoke' });
    expect(await select(db, w.guardian, `select * from public.parent_briefs where id = $1`, [b.brief_id])).toEqual([]);
  });
  it('per-record sharing: coach sees a reflection only while granted; new coach sees no history automatically', async () => {
    const r = await submitReflection(db, w.minor, 'History item', 'History moment');
    expect(await select(db, w.coach, `select id from public.reflections where id = $1`, [r])).toEqual([]);
    const g = await rpc<{ grant_id: string }>(db, w.minor, 'grant_share', { p_record_type: 'reflection', p_record_id: r, p_recipient: w.coach.id, p_surface: 'coach_history', p_purpose: 'context for coach' });
    expect(await select(db, w.coach, `select id from public.reflections where id = $1`, [r])).toHaveLength(1);
    // Granting to an unverified coach is refused.
    await expectLoopError(rpc(db, w.minor, 'grant_share', { p_record_type: 'reflection', p_record_id: r, p_recipient: w.pendingCoach.id, p_surface: 'coach_history', p_purpose: 'x' }), 'coach_not_verified');
    await rpc(db, w.minor, 'revoke_share', { p_grant_id: g.grant_id });
    expect(await select(db, w.coach, `select id from public.reflections where id = $1`, [r])).toEqual([]);
  });
});
