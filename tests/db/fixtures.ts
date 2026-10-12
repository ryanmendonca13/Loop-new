import type { Actor, Db } from './harness';
import { createAuthUser, rpc, superuser } from './harness';

export const POLICY = 'pilot-2026-10';

export interface World {
  reviewer: Actor;
  safeguarding: Actor;
  adult: Actor & { athleteId: string };
  minor: Actor & { athleteId: string };
  minorTwin: Actor & { athleteId: string };
  guardian: Actor & { linkId: string };
  otherGuardian: Actor;
  coach: Actor & { relId: string };
  pendingCoach: Actor & { relId: string };
  adultCoach: Actor & { relId: string };
  outsider: Actor;
}

export async function registerAthlete(db: Db, email: string, name: string, band: '13_17' | '18_plus' | 'under_13') {
  const u = await createAuthUser(db, email);
  const r = await rpc<{ athlete_id: string; account_state: string }>(db, u, 'register_profile', {
    p_display_name: name, p_eligibility_band: band, p_timezone: 'America/Toronto', p_as_athlete: true, p_privacy_policy_version: POLICY,
  });
  return { ...u, athleteId: r.athlete_id, accountState: r.account_state };
}

export async function registerAdult(db: Db, email: string, name: string) {
  const u = await createAuthUser(db, email);
  await rpc(db, u, 'register_profile', { p_display_name: name, p_eligibility_band: '18_plus', p_timezone: 'America/Toronto', p_as_athlete: false, p_privacy_policy_version: POLICY });
  return u;
}

export async function linkGuardian(db: Db, athlete: Actor, guardian: Actor, reviewer: Actor): Promise<string> {
  const inv = await rpc<{ token: string }>(db, athlete, 'create_guardian_invite', { p_guardian_email: guardian.email });
  const link = await rpc<{ link_id: string }>(db, guardian, 'redeem_guardian_invite', { p_token: inv.token });
  await rpc(db, { ...reviewer, aal: 'aal2' }, 'review_guardian_link', { p_link_id: link.link_id, p_decision: 'verify', p_evidence_ref: 'pilot-call-001' });
  return link.link_id;
}

export async function activateMinor(db: Db, minor: Actor & { athleteId: string }, guardian: Actor, reviewer: Actor): Promise<string> {
  const linkId = await linkGuardian(db, minor, guardian, reviewer);
  await rpc(db, guardian, 'record_consent', { p_purpose: 'guardian_consent', p_policy_version: POLICY, p_scope: ['coach_exchange'], p_athlete_id: minor.athleteId });
  const r = await rpc<{ account_state: string }>(db, minor, 'record_consent', { p_purpose: 'athlete_assent', p_policy_version: POLICY });
  if (r.account_state !== 'active') throw new Error(`minor not active: ${r.account_state}`);
  return linkId;
}

export async function inviteCoach(db: Db, athlete: Actor, coach: Actor, name = 'Coach'): Promise<string> {
  const inv = await rpc<{ token: string }>(db, athlete, 'create_coach_invite', { p_coach_name: name, p_coach_email: coach.email });
  const rel = await rpc<{ relationship_id: string }>(db, coach, 'redeem_coach_invite', { p_token: inv.token });
  return rel.relationship_id;
}

export async function buildWorld(db: Db): Promise<World> {
  const reviewer = await registerAdult(db, 'reviewer@pilot.test', 'Pilot Reviewer');
  const safeguarding = await registerAdult(db, 'safe@pilot.test', 'Safeguarding Owner');
  await superuser(db, `insert into public.staff_roles (user_id, role) values ($1, 'verification_reviewer'), ($2, 'safeguarding_owner')`, [reviewer.id, safeguarding.id]);
  await superuser(db, `insert into public.app_settings (key, value) values ('safeguarding_owner_user_id', to_jsonb($1::text))`, [safeguarding.id]);

  const adult = await registerAthlete(db, 'ava.adult@athlete.test', 'Ava', '18_plus');
  const minor = await registerAthlete(db, 'max@athlete.test', 'Max', '13_17');
  const minorTwin = await registerAthlete(db, 'ava.minor@athlete.test', 'Ava', '13_17');
  const guardian = await registerAdult(db, 'pat@family.test', 'Pat (guardian)');
  const otherGuardian = await registerAdult(db, 'quinn@family.test', 'Quinn (guardian)');
  const outsider = await registerAdult(db, 'outsider@x.test', 'Outsider');
  const linkId = await activateMinor(db, minor, guardian, reviewer);
  await activateMinor(db, minorTwin, otherGuardian, reviewer);

  for (const a of [adult, minor, minorTwin]) await rpc(db, a, 'record_consent', { p_purpose: 'coach_sharing', p_policy_version: POLICY });

  const coach = await registerAdult(db, 'sam@coach.test', 'Coach Sam');
  const pendingCoach = await registerAdult(db, 'kim@coach.test', 'Coach Kim');
  const adultCoach = await registerAdult(db, 'lee@coach.test', 'Coach Lee');
  const relId = await inviteCoach(db, minor, coach, 'Coach Sam');
  await rpc(db, guardian, 'guardian_approve_coach', { p_rel_id: relId });
  await rpc(db, { ...reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: relId, p_decision: 'verify', p_evidence_ref: 'id-check-sam' });
  const pendingRel = await inviteCoach(db, minor, pendingCoach, 'Coach Kim');
  const adultRel = await inviteCoach(db, adult, adultCoach, 'Coach Lee');
  await rpc(db, { ...reviewer, aal: 'aal2' }, 'review_coach_relationship', { p_rel_id: adultRel, p_decision: 'verify', p_evidence_ref: 'id-check-lee' });

  return {
    reviewer, safeguarding, adult, minor, minorTwin, otherGuardian, outsider,
    guardian: { ...guardian, linkId },
    coach: { ...coach, relId },
    pendingCoach: { ...pendingCoach, relId: pendingRel },
    adultCoach: { ...adultCoach, relId: adultRel },
  };
}

let seq = 0;
export const key = (p = 'k') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}xx`;

export async function submitReflection(db: Db, athlete: Actor, well = 'I kept my first touch clean.', back = 'I hesitated before the shot.') {
  const r = await rpc<{ reflection_id: string }>(db, athlete, 'submit_reflection', {
    p_reflection_id: null, p_assignment_id: null, p_answer_well: well, p_answer_moment_back: back, p_support_request: null, p_mood: null, p_idempotency_key: key('ref'),
  });
  return r.reflection_id;
}

export async function openRequest(db: Db, athlete: Actor, relId: string, reflectionId: string) {
  const prev = await rpc<{ hash: string }>(db, athlete, 'preview_exchange_audience', { p_rel_id: relId });
  return rpc<{ request_id: string }>(db, athlete, 'create_loop_request', {
    p_reflection_id: reflectionId, p_rel_id: relId, p_shared_excerpt: 'I hesitated before the shot.', p_question: 'How do I shoot sooner?',
    p_confirmed_audience_hash: prev.hash, p_idempotency_key: key('req'),
  });
}
