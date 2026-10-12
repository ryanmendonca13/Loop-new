-- Onboarding, guardian activation, consent, coach invitations/verification.
-- All RPCs: SECURITY DEFINER, empty search_path, explicit auth.uid() checks, audited.

create or replace function app.token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest('invite:' || p_token, 'sha256'), 'hex')
$$;

create or replace function app.email_hash(p_email text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest('email:' || lower(trim(p_email)), 'sha256'), 'hex')
$$;

create or replace function app.mask_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select left(split_part(lower(trim(p_email)), '@', 1), 1) || '•••@' || split_part(lower(trim(p_email)), '@', 2)
$$;

create or replace function app.new_token() returns text
language sql volatile set search_path = '' as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

/** Returns the caller's verified auth email, or fails. Email verification proves account control only. */
create or replace function app.verified_email() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select u.email into v from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v is null then perform app.fail('unauthorized', 'Verify your email address first.'); end if;
  return v;
end $$;

create or replace function app.has_consent(p_subject uuid, p_purpose text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consent_records c
                 where c.subject_user_id = p_subject and c.purpose = p_purpose and c.withdrawn_at is null)
$$;

create or replace function app.enqueue_in_app(p_recipient uuid, p_purpose text, p_title text, p_link text,
  p_key text, p_session uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.notification_preferences n where n.user_id = p_recipient and not n.in_app_enabled) then
    return;
  end if;
  insert into public.notification_jobs (recipient_user_id, channel, purpose, due_at, idempotency_key, title, link_path, related_session_id, state, attempt_count)
  values (p_recipient, 'in_app', p_purpose, now(), p_key, p_title, p_link, p_session, 'sent', 1)
  on conflict (idempotency_key) do nothing;
end $$;

-- ------------------------------------------------------------------ activation
create or replace function app.activation_gaps(p_athlete uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid; v_band text; v_gaps text[] := '{}';
begin
  select a.user_id, p.eligibility_band into v_user, v_band
  from public.athletes a join public.profiles p on p.id = a.user_id where a.id = p_athlete;
  if not app.has_consent(v_user, 'privacy_notice') then v_gaps := array_append(v_gaps, 'privacy_notice'); end if;
  if v_band = '18_plus' then return v_gaps; end if;
  if v_band = 'under_13' then v_gaps := array_append(v_gaps, 'under_13_review'); end if;
  if not exists (select 1 from public.guardian_links g where g.athlete_id = p_athlete and g.status = 'active'
                 and g.revoked_at is null and g.verified_at is not null) then
    v_gaps := array_append(v_gaps, 'verified_guardian_link');
  end if;
  if not app.has_consent(v_user, 'guardian_consent') then v_gaps := array_append(v_gaps, 'guardian_consent'); end if;
  if not app.has_consent(v_user, 'athlete_assent') then v_gaps := array_append(v_gaps, 'athlete_assent'); end if;
  return v_gaps;
end $$;

create or replace function app.try_activate(p_athlete uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_state text; v_user uuid;
begin
  select a.activation_state, a.user_id into v_state, v_user from public.athletes a where a.id = p_athlete;
  if v_state in ('pending_guardian', 'withdrawal_pending') and cardinality(app.activation_gaps(p_athlete)) = 0 then
    update public.athletes set activation_state = 'active' where id = p_athlete;
    update public.profiles set account_state = 'active' where id = v_user;
    perform app.audit('athlete.activated', 'athlete', array[p_athlete], 'activation');
    return 'active';
  end if;
  return v_state;
end $$;

/**
 * Creates the caller's profile. Athletes under 18 receive a minimal pending shell: display name,
 * eligibility band and timezone only. No diary or audio can be stored until activation.
 */
create or replace function public.register_profile(p_display_name text, p_eligibility_band text, p_timezone text,
  p_as_athlete boolean, p_privacy_policy_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_athlete uuid;
  v_state text;
begin
  perform app.verified_email();
  if exists (select 1 from public.profiles where id = v_uid) then
    perform app.fail('conflict', 'Profile already exists.');
  end if;
  if not p_as_athlete and p_eligibility_band <> '18_plus' then
    perform app.fail('forbidden', 'Guardian, coach and staff accounts must be adults.');
  end if;
  v_state := case when p_eligibility_band = '18_plus' then 'active' else 'pending_guardian' end;
  insert into public.profiles (id, display_name, eligibility_band, timezone, account_state)
  values (v_uid, trim(p_display_name), p_eligibility_band, coalesce(nullif(p_timezone, ''), 'UTC'), v_state);
  insert into public.consent_records (subject_user_id, actor_user_id, purpose, policy_version, provenance)
  values (v_uid, v_uid, 'privacy_notice', p_privacy_policy_version, 'register_profile');
  insert into public.notification_preferences (user_id) values (v_uid);
  if p_as_athlete then
    insert into public.athletes (user_id, activation_state) values (v_uid, 'pending_guardian') returning id into v_athlete;
    insert into public.focus_plans (athlete_id) values (v_athlete);
    v_state := app.try_activate(v_athlete);
  end if;
  perform app.audit('profile.registered', 'profile', array[v_uid], 'onboarding', null,
    jsonb_build_object('band', p_eligibility_band, 'athlete', p_as_athlete));
  return jsonb_build_object('profile_id', v_uid, 'athlete_id', v_athlete, 'account_state', v_state);
end $$;

-- ------------------------------------------------------------------ guardian invitations and links
create or replace function public.create_guardian_invite(p_guardian_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_athlete uuid := app.my_athlete_id();
  v_token text := app.new_token();
  v_id uuid;
  v_expiry interval := coalesce((select (value #>> '{}')::interval from public.app_settings where key = 'guardian_invite_expiry'), interval '7 days');
begin
  if v_athlete is null then perform app.fail('forbidden', 'Only athletes can invite a guardian.'); end if;
  if p_guardian_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_guardian_email) > 254 then
    perform app.fail('validation', 'Enter a valid email address.');
  end if;
  perform app.rate_limit('guardian_invite', 5, interval '1 day');
  insert into public.guardian_invites (athlete_id, intended_email_hash, intended_email_hint, token_hash, expires_at, created_by)
  values (v_athlete, app.email_hash(p_guardian_email), app.mask_email(p_guardian_email), app.token_hash(v_token), now() + v_expiry, v_uid)
  returning id into v_id;
  perform app.audit('guardian_invite.created', 'guardian_invite', array[v_id, v_athlete], 'guardian_activation');
  -- The plaintext token is returned once and never stored. It carries no athlete data.
  return jsonb_build_object('invite_id', v_id, 'token', v_token, 'expires_at', now() + v_expiry);
end $$;

create or replace function public.cancel_guardian_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_uid();
  update public.guardian_invites set revoked_at = now()
  where id = p_invite_id and app.is_athlete_owner(athlete_id) and redeemed_at is null and revoked_at is null;
  if not found then perform app.fail('not_found', 'Invite not found.'); end if;
  perform app.audit('guardian_invite.revoked', 'guardian_invite', array[p_invite_id], 'guardian_activation');
end $$;

create or replace function public.redeem_guardian_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_email text := app.verified_email();
  v_inv public.guardian_invites;
  v_link uuid;
begin
  perform app.rate_limit('invite_redeem', 10, interval '1 hour');
  select * into v_inv from public.guardian_invites where token_hash = app.token_hash(p_token) for update;
  if v_inv.id is null then perform app.fail('invite_invalid', 'not_found'); end if;
  if v_inv.revoked_at is not null then perform app.fail('invite_invalid', 'revoked'); end if;
  if v_inv.redeemed_at is not null then perform app.fail('invite_invalid', 'already_redeemed'); end if;
  if v_inv.expires_at <= now() then perform app.fail('invite_invalid', 'expired'); end if;
  if v_inv.intended_email_hash <> app.email_hash(v_email) then perform app.fail('invite_invalid', 'email_mismatch'); end if;
  if not exists (select 1 from public.profiles where id = v_uid and eligibility_band = '18_plus') then
    perform app.fail('forbidden', 'A guardian must have an adult profile.');
  end if;
  if exists (select 1 from public.athletes where id = v_inv.athlete_id and user_id = v_uid) then
    perform app.fail('forbidden', 'You cannot be your own guardian.');
  end if;
  update public.guardian_invites set redeemed_at = now(), redeemed_by = v_uid where id = v_inv.id;
  -- Linkage is NOT inferred from names or email: it enters human verification.
  insert into public.guardian_links (guardian_user_id, athlete_id, invite_id, status)
  values (v_uid, v_inv.athlete_id, v_inv.id, 'pending_verification') returning id into v_link;
  perform app.audit('guardian_link.pending', 'guardian_link', array[v_link, v_inv.athlete_id], 'guardian_activation');
  return jsonb_build_object('link_id', v_link, 'status', 'pending_verification');
end $$;

/** Human verification of a guardian/child linkage by a pilot verification reviewer (aal2). */
create or replace function public.review_guardian_link(p_link_id uuid, p_decision text, p_evidence_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_link public.guardian_links;
begin
  if not app.is_staff('verification_reviewer') then perform app.fail('forbidden', 'Verification reviewer with MFA required.'); end if;
  select * into v_link from public.guardian_links where id = p_link_id for update;
  if v_link.id is null or v_link.status <> 'pending_verification' then perform app.fail('invalid_transition', 'Link is not pending verification.'); end if;
  if v_link.guardian_user_id = v_uid or app.is_athlete_owner(v_link.athlete_id) then
    perform app.fail('forbidden', 'Reviewers cannot verify their own relationships.');
  end if;
  if coalesce(trim(p_evidence_ref), '') = '' then perform app.fail('validation', 'Evidence reference required.'); end if;
  if p_decision = 'verify' then
    update public.guardian_links set status = 'active', verified_by = v_uid, verified_at = now(), verification_evidence_ref = p_evidence_ref
    where id = p_link_id;
  elsif p_decision = 'reject' then
    update public.guardian_links set status = 'rejected', verified_by = null, verification_evidence_ref = p_evidence_ref where id = p_link_id;
  else
    perform app.fail('validation', 'Decision must be verify or reject.');
  end if;
  perform app.audit('guardian_link.' || p_decision, 'guardian_link', array[p_link_id, v_link.athlete_id], 'guardian_verification',
    null, jsonb_build_object('evidence_ref', p_evidence_ref));
end $$;

/** Records a versioned consent. Guardian consent can only be given by an active, verified linked guardian. */
create or replace function public.record_consent(p_purpose text, p_policy_version text, p_scope text[] default '{}',
  p_athlete_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_subject uuid := v_uid;
  v_athlete uuid;
  v_id uuid;
  v_state text;
begin
  if p_purpose = 'guardian_consent' then
    if p_athlete_id is null or not app.is_active_guardian(p_athlete_id) then
      perform app.fail('forbidden', 'Only a verified linked guardian can give guardian consent.');
    end if;
    select user_id into v_subject from public.athletes where id = p_athlete_id;
    v_athlete := p_athlete_id;
  elsif p_purpose in ('privacy_notice', 'athlete_assent', 'coach_sharing', 'ai_processing', 'voice_recording', 'email_notifications') then
    v_athlete := app.my_athlete_id();
    if p_purpose = 'athlete_assent' and v_athlete is null then perform app.fail('forbidden', 'Assent is for athletes.'); end if;
  elsif p_purpose = 'sms_notifications' then
    perform app.fail('feature_disabled', 'SMS is not available.');
  else
    perform app.fail('validation', 'Unknown consent purpose.');
  end if;
  if exists (select 1 from public.consent_records where subject_user_id = v_subject and purpose = p_purpose and withdrawn_at is null) then
    select id into v_id from public.consent_records where subject_user_id = v_subject and purpose = p_purpose and withdrawn_at is null limit 1;
  else
    insert into public.consent_records (subject_user_id, actor_user_id, purpose, policy_version, scope, provenance)
    values (v_subject, v_uid, p_purpose, p_policy_version, coalesce(p_scope, '{}'), 'in_app:' || p_purpose)
    returning id into v_id;
    perform app.audit('consent.granted', 'consent', array[v_id], p_purpose, null, jsonb_build_object('policy_version', p_policy_version));
  end if;
  if v_athlete is not null then v_state := app.try_activate(v_athlete); end if;
  return jsonb_build_object('consent_id', v_id, 'account_state', v_state);
end $$;

/** Cancels active coach requests for an athlete (optionally for one relationship). Never fabricates closure. */
create or replace function app.cancel_active_requests(p_athlete uuid, p_reason text, p_rel uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.loop_requests set state = 'canceled'
  where athlete_id = p_athlete and state in ('queued', 'waiting_for_coach', 'response_draft')
    and (p_rel is null or coach_relationship_id = p_rel);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform app.audit('loop_request.canceled_by_policy', 'athlete', array[p_athlete], p_reason, null, jsonb_build_object('count', v_n));
  end if;
  return v_n;
end $$;

/**
 * Consent withdrawal. Takes effect on new processing/reads immediately. Already viewed content cannot be recalled.
 * Guardian consent withdrawal moves a minor into the withdrawal workflow (account withdrawal_pending).
 */
create or replace function public.withdraw_consent(p_consent_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_c public.consent_records; v_athlete uuid;
begin
  select * into v_c from public.consent_records where id = p_consent_id and withdrawn_at is null for update;
  if v_c.id is null or (v_c.subject_user_id <> v_uid and v_c.actor_user_id <> v_uid) then
    perform app.fail('not_found', 'Consent not found.');
  end if;
  update public.consent_records set withdrawn_at = now() where id = p_consent_id;
  select id into v_athlete from public.athletes where user_id = v_c.subject_user_id;
  if v_c.purpose in ('guardian_consent', 'athlete_assent', 'privacy_notice') and v_athlete is not null then
    update public.athletes set activation_state = 'withdrawal_pending' where id = v_athlete and activation_state = 'active';
    update public.profiles set account_state = 'withdrawal_pending' where id = v_c.subject_user_id and account_state = 'active';
    perform app.cancel_active_requests(v_athlete, 'consent_withdrawn');
    update public.parent_briefs set state = 'revoked' where athlete_id = v_athlete and state = 'published';
  elsif v_c.purpose = 'coach_sharing' and v_athlete is not null then
    perform app.cancel_active_requests(v_athlete, 'coach_sharing_withdrawn');
  elsif v_c.purpose = 'voice_recording' then
    update public.voice_assets set retention_state = 'delete_pending' where owner_user_id = v_c.subject_user_id and retention_state = 'active';
  elsif v_c.purpose = 'email_notifications' then
    update public.notification_jobs set state = 'canceled' where recipient_user_id = v_c.subject_user_id and channel = 'email' and state = 'pending';
    update public.notification_preferences set email_reminders = false where user_id = v_c.subject_user_id;
  end if;
  perform app.audit('consent.withdrawn', 'consent', array[p_consent_id], v_c.purpose);
end $$;

create or replace function public.revoke_guardian_link(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_link public.guardian_links;
begin
  select * into v_link from public.guardian_links where id = p_link_id for update;
  if v_link.id is null or not (v_link.guardian_user_id = v_uid or app.is_athlete_owner(v_link.athlete_id)) then
    perform app.fail('not_found', 'Link not found.');
  end if;
  if v_link.status in ('revoked', 'rejected') then return; end if;
  update public.guardian_links set status = 'revoked', revoked_at = now() where id = p_link_id;
  update public.parent_briefs set state = 'revoked' where guardian_link_id = p_link_id and state <> 'revoked';
  update public.sharing_grants set revoked_at = now()
    where owner_athlete_id = v_link.athlete_id and recipient_user_id = v_link.guardian_user_id and revoked_at is null;
  -- Rule of Two: exchanges that relied on this adult can no longer proceed.
  update public.loop_requests q set state = 'canceled'
    from public.coach_relationships r
    where q.coach_relationship_id = r.id and r.second_adult_user_id = v_link.guardian_user_id
      and q.athlete_id = v_link.athlete_id and q.state in ('queued', 'waiting_for_coach', 'response_draft');
  update public.coach_relationships set second_adult_user_id = null
    where athlete_id = v_link.athlete_id and second_adult_user_id = v_link.guardian_user_id;
  if app.is_minor(v_link.athlete_id) and not exists (
      select 1 from public.guardian_links where athlete_id = v_link.athlete_id and status = 'active') then
    update public.athletes set activation_state = 'withdrawal_pending' where id = v_link.athlete_id and activation_state = 'active';
    update public.profiles p set account_state = 'withdrawal_pending' from public.athletes a
      where a.id = v_link.athlete_id and p.id = a.user_id and p.account_state = 'active';
  end if;
  perform app.audit('guardian_link.revoked', 'guardian_link', array[p_link_id, v_link.athlete_id], 'withdrawal', 'guardian_removed');
end $$;

-- ------------------------------------------------------------------ coach invitations and verification
create or replace function public.create_coach_invite(p_coach_name text, p_coach_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_athlete uuid := app.my_athlete_id();
  v_token text := app.new_token();
  v_id uuid;
  v_expiry interval := coalesce((select (value #>> '{}')::interval from public.app_settings where key = 'coach_invite_expiry'), interval '7 days');
begin
  if v_athlete is null or not exists (select 1 from public.athletes where id = v_athlete and activation_state = 'active') then
    perform app.fail('account_not_active', 'Activate your account before inviting a coach.');
  end if;
  if char_length(trim(coalesce(p_coach_name, ''))) not between 1 and 60 then perform app.fail('validation', 'Coach name is required.'); end if;
  if p_coach_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(p_coach_email) > 254 then
    perform app.fail('validation', 'Enter a valid email address.');
  end if;
  perform app.rate_limit('coach_invite', 5, interval '1 day');
  insert into public.coach_invites (athlete_id, coach_display_name, intended_email_hash, intended_email_hint, token_hash, expires_at, created_by)
  values (v_athlete, trim(p_coach_name), app.email_hash(p_coach_email), app.mask_email(p_coach_email), app.token_hash(v_token), now() + v_expiry, v_uid)
  returning id into v_id;
  perform app.audit('coach_invite.created', 'coach_invite', array[v_id, v_athlete], 'coach_invitation');
  return jsonb_build_object('invite_id', v_id, 'token', v_token, 'expires_at', now() + v_expiry);
end $$;

create or replace function public.revoke_coach_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_uid();
  update public.coach_invites set revoked_at = now()
  where id = p_invite_id and app.is_athlete_owner(athlete_id) and redeemed_at is null and revoked_at is null;
  if not found then perform app.fail('not_found', 'Invite not found.'); end if;
  perform app.audit('coach_invite.revoked', 'coach_invite', array[p_invite_id], 'coach_invitation');
end $$;

create or replace function app.default_second_adult(p_athlete uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select g.guardian_user_id from public.guardian_links g
  where g.athlete_id = p_athlete and g.status = 'active' and g.revoked_at is null
  order by g.verified_at asc limit 1
$$;

create or replace function public.redeem_coach_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_email text := app.verified_email();
  v_inv public.coach_invites;
  v_rel uuid;
begin
  perform app.rate_limit('invite_redeem', 10, interval '1 hour');
  select * into v_inv from public.coach_invites where token_hash = app.token_hash(p_token) for update;
  if v_inv.id is null then perform app.fail('invite_invalid', 'not_found'); end if;
  if v_inv.revoked_at is not null then perform app.fail('invite_invalid', 'revoked'); end if;
  if v_inv.redeemed_at is not null then perform app.fail('invite_invalid', 'already_redeemed'); end if;
  if v_inv.expires_at <= now() then perform app.fail('invite_invalid', 'expired'); end if;
  if v_inv.intended_email_hash <> app.email_hash(v_email) then perform app.fail('invite_invalid', 'email_mismatch'); end if;
  if not exists (select 1 from public.profiles where id = v_uid and eligibility_band = '18_plus' and account_state = 'active') then
    perform app.fail('forbidden', 'Coaches need an active adult profile.');
  end if;
  if exists (select 1 from public.athletes where id = v_inv.athlete_id and user_id = v_uid) then
    perform app.fail('forbidden', 'You cannot coach yourself.');
  end if;
  update public.coach_invites set redeemed_at = now(), redeemed_by = v_uid where id = v_inv.id;
  insert into public.coach_relationships (athlete_id, coach_user_id, invite_id, verification_state, athlete_confirmed_at, second_adult_user_id)
  values (v_inv.athlete_id, v_uid, v_inv.id, 'identity_pending', v_inv.created_at,
          case when app.is_minor(v_inv.athlete_id) then app.default_second_adult(v_inv.athlete_id) end)
  on conflict (athlete_id, coach_user_id) where active do update set invite_id = excluded.invite_id
  returning id into v_rel;
  perform app.audit('coach_relationship.identity_pending', 'coach_relationship', array[v_rel, v_inv.athlete_id], 'coach_verification');
  return jsonb_build_object('relationship_id', v_rel, 'verification_state', 'identity_pending');
end $$;

/** For minors, a linked guardian approves the specific coach relationship before verification. */
create or replace function public.guardian_approve_coach(p_rel_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_rel public.coach_relationships;
begin
  select * into v_rel from public.coach_relationships where id = p_rel_id for update;
  if v_rel.id is null or not app.is_active_guardian(v_rel.athlete_id) then perform app.fail('forbidden', 'Not a linked guardian.'); end if;
  update public.coach_relationships set guardian_approved_by = v_uid, guardian_approved_at = now(),
    second_adult_user_id = coalesce(second_adult_user_id, v_uid)
  where id = p_rel_id;
  perform app.audit('coach_relationship.guardian_approved', 'coach_relationship', array[p_rel_id, v_rel.athlete_id], 'coach_verification');
end $$;

/** Documented human review: identity + athlete/guardian-approved relationship. Not a background check. */
create or replace function public.review_coach_relationship(p_rel_id uuid, p_decision text, p_evidence_ref text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_rel public.coach_relationships; v_next text;
begin
  if not app.is_staff('verification_reviewer') then perform app.fail('forbidden', 'Verification reviewer with MFA required.'); end if;
  if coalesce(trim(p_evidence_ref), '') = '' then perform app.fail('validation', 'Evidence reference required.'); end if;
  select * into v_rel from public.coach_relationships where id = p_rel_id for update;
  if v_rel.id is null then perform app.fail('not_found', 'Relationship not found.'); end if;
  if v_rel.coach_user_id = v_uid or app.is_athlete_owner(v_rel.athlete_id) or app.is_active_guardian(v_rel.athlete_id) then
    perform app.fail('forbidden', 'Reviewers cannot verify their own relationships.');
  end if;
  v_next := case p_decision when 'verify' then 'verified' when 'reject' then 'rejected' when 'suspend' then 'suspended' when 'reinstate' then 'verified' end;
  if v_next is null then perform app.fail('validation', 'Unknown decision.'); end if;
  if not ((v_rel.verification_state in ('invited', 'identity_pending') and v_next in ('verified', 'rejected'))
       or (v_rel.verification_state = 'verified' and v_next = 'suspended')
       or (v_rel.verification_state = 'suspended' and v_next in ('verified', 'rejected'))) then
    perform app.fail('invalid_transition', 'coach_verification: invalid transition');
  end if;
  if v_next = 'verified' then
    if v_rel.athlete_confirmed_at is null then perform app.fail('validation', 'Athlete has not approved this coach.'); end if;
    if app.is_minor(v_rel.athlete_id) and v_rel.guardian_approved_at is null then
      perform app.fail('validation', 'A linked guardian must approve this coach first.');
    end if;
    update public.coach_relationships set verification_state = 'verified', verified_by = v_uid, verified_at = now(),
      verification_evidence_ref = p_evidence_ref where id = p_rel_id;
  else
    update public.coach_relationships set verification_state = v_next, verification_evidence_ref = p_evidence_ref where id = p_rel_id;
    if v_next in ('suspended', 'rejected') then perform app.cancel_active_requests(v_rel.athlete_id, 'coach_' || v_next, p_rel_id); end if;
  end if;
  perform app.audit('coach_relationship.' || v_next, 'coach_relationship', array[p_rel_id, v_rel.athlete_id], 'coach_verification',
    null, jsonb_build_object('evidence_ref', p_evidence_ref));
end $$;

create or replace function public.revoke_coach_relationship(p_rel_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rel public.coach_relationships;
begin
  perform app.require_uid();
  select * into v_rel from public.coach_relationships where id = p_rel_id for update;
  if v_rel.id is null or not (app.is_athlete_owner(v_rel.athlete_id) or app.is_active_guardian(v_rel.athlete_id)) then
    perform app.fail('not_found', 'Relationship not found.');
  end if;
  update public.coach_relationships set active = false, revoked_at = now() where id = p_rel_id;
  update public.sharing_grants set revoked_at = now() where relationship_id = p_rel_id and revoked_at is null;
  perform app.cancel_active_requests(v_rel.athlete_id, 'coach_revoked', p_rel_id);
  perform app.audit('coach_relationship.revoked', 'coach_relationship', array[p_rel_id, v_rel.athlete_id], 'access_change', 'coach_removed');
end $$;

create or replace function public.set_second_adult(p_rel_id uuid, p_guardian_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rel public.coach_relationships;
begin
  perform app.require_uid();
  select * into v_rel from public.coach_relationships where id = p_rel_id for update;
  if v_rel.id is null or not (app.is_athlete_owner(v_rel.athlete_id) or app.is_active_guardian(v_rel.athlete_id)) then
    perform app.fail('not_found', 'Relationship not found.');
  end if;
  -- Default approved policy: the second adult must be an active, verified linked guardian.
  if not app.is_active_guardian(v_rel.athlete_id, p_guardian_user_id) then
    perform app.fail('second_adult_required', 'The second adult must be an active linked guardian.');
  end if;
  update public.coach_relationships set second_adult_user_id = p_guardian_user_id where id = p_rel_id;
  perform app.audit('coach_relationship.second_adult_set', 'coach_relationship', array[p_rel_id, v_rel.athlete_id], 'rule_of_two', 'second_adult_changed');
end $$;

/** Minimal operational metadata for the verification queue. No reflection/request content. */
create or replace function public.verification_queue() returns table (kind text, id uuid, athlete_id uuid, subject_user_id uuid,
  state text, guardian_approved boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_staff('verification_reviewer') then perform app.fail('forbidden', 'Verification reviewer with MFA required.'); end if;
  return query
    select 'coach'::text, r.id, r.athlete_id, r.coach_user_id, r.verification_state, r.guardian_approved_at is not null, r.created_at
    from public.coach_relationships r where r.active and r.verification_state in ('identity_pending', 'suspended')
    union all
    select 'guardian'::text, g.id, g.athlete_id, g.guardian_user_id, g.status, null::boolean, g.created_at
    from public.guardian_links g where g.status = 'pending_verification'
    order by 7;
end $$;
