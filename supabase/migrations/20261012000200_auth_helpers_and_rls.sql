-- Authorization helpers and deny-by-default Row Level Security.
-- Helpers are SECURITY DEFINER so policies do not recurse; each answers a yes/no question about
-- auth.uid() only and never returns content. Client-supplied role/owner ids are never trusted.

create or replace function app.fail(p_code text, p_message text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'LOOP:%:%', p_code, p_message using errcode = 'P0001';
end $$;

create or replace function app.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null then perform app.fail('unauthorized', 'Sign in required.'); end if;
  return v;
end $$;

create or replace function app.is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function app.has_staff_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_roles s
                 where s.user_id = auth.uid() and s.role = p_role and s.revoked_at is null)
$$;

/** Staff powers require the role AND a second authentication factor (aal2). */
create or replace function app.is_staff(p_role text) returns boolean
language sql stable set search_path = '' as $$
  select app.has_staff_role(p_role) and app.is_aal2()
$$;

create or replace function app.my_athlete_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select a.id from public.athletes a where a.user_id = auth.uid()
$$;

create or replace function app.is_athlete_owner(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.athletes a where a.id = p_athlete and a.user_id = auth.uid())
$$;

create or replace function app.is_active_guardian(p_athlete uuid, p_user uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardian_links g
                 where g.athlete_id = p_athlete and g.guardian_user_id = coalesce(p_user, auth.uid())
                   and g.status = 'active' and g.revoked_at is null and g.verified_at is not null)
$$;

create or replace function app.is_verified_coach(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_relationships r
                 where r.athlete_id = p_athlete and r.coach_user_id = auth.uid()
                   and r.active and r.revoked_at is null and r.verification_state = 'verified')
$$;

create or replace function app.is_verified_relationship_coach(p_rel uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_relationships r
                 where r.id = p_rel and r.coach_user_id = auth.uid()
                   and r.active and r.revoked_at is null and r.verification_state = 'verified')
$$;

create or replace function app.is_minor(p_athlete uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.eligibility_band <> '18_plus' from public.athletes a
                   join public.profiles p on p.id = a.user_id where a.id = p_athlete), true)
$$;

/** Second adult may see a shared exchange only while named in its audience AND still an active linked guardian. */
create or replace function app.is_audience_second_adult(p_athlete uuid, p_audience jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_audience -> 'members', '[]'::jsonb)) m
    where (m ->> 'userId')::uuid = auth.uid() and m ->> 'role' = 'second_adult'
  ) and app.is_active_guardian(p_athlete)
$$;

create or replace function app.is_team_staff(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.team_id = p_team and m.user_id = auth.uid() and m.role in ('coach', 'director')
                   and m.status = 'active' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
$$;

create or replace function app.is_team_member(p_team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.team_id = p_team and m.user_id = auth.uid()
                   and m.status = 'active' and m.starts_at <= now() and (m.ends_at is null or m.ends_at > now()))
$$;

create or replace function app.is_tenant_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m
                 where m.tenant_id = p_tenant and m.user_id = auth.uid()
                   and m.status = 'active' and (m.ends_at is null or m.ends_at > now()))
$$;

/** Profiles are visible only to people in a live, verified relationship. Not a directory. */
create or replace function app.can_see_profile(p_profile uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_profile = auth.uid()
  or exists ( -- I coach (verified) or guard (active) this athlete
    select 1 from public.athletes a where a.user_id = p_profile
      and (app.is_verified_coach(a.id) or app.is_active_guardian(a.id)))
  or exists ( -- this person coaches or is second adult for my athlete profile (any live relationship state, name only)
    select 1 from public.coach_relationships r join public.athletes a on a.id = r.athlete_id
    where a.user_id = auth.uid() and r.active and (r.coach_user_id = p_profile or r.second_adult_user_id = p_profile))
  or exists ( -- this person is a guardian (live link) of my athlete profile
    select 1 from public.guardian_links g join public.athletes a on a.id = g.athlete_id
    where a.user_id = auth.uid() and g.guardian_user_id = p_profile and g.status in ('pending_verification', 'active'))
  or exists ( -- I am a coach with a verified relationship and this is the named second adult
    select 1 from public.coach_relationships r
    where r.coach_user_id = auth.uid() and r.second_adult_user_id = p_profile and r.active and r.verification_state = 'verified')
  or exists ( -- I am a guardian, this is a verified coach of my linked athlete
    select 1 from public.coach_relationships r
    where r.coach_user_id = p_profile and r.active and r.verification_state = 'verified' and app.is_active_guardian(r.athlete_id))
  or exists ( -- I hold a guardian link (any live state) to this athlete's profile: name only for activation progress
    select 1 from public.guardian_links g join public.athletes a on a.id = g.athlete_id
    where g.guardian_user_id = auth.uid() and a.user_id = p_profile and g.status in ('pending_verification', 'active'))
  or app.is_staff('verification_reviewer')
  or app.is_staff('safeguarding_owner')
$$;

/** Fixed-window rate limit; raises rate_limited when exceeded. */
create or replace function app.rate_limit(p_bucket text, p_max integer, p_window interval) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits integer;
begin
  insert into public.rate_limits (bucket, actor, window_start, hits) values (p_bucket, v_uid, v_start, 1)
  on conflict (bucket, actor, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  if v_hits > p_max then perform app.fail('rate_limited', 'Too many attempts. Please wait and try again.'); end if;
end $$;

/** Append-only audit write. Metadata must be identifiers/states only (enforced by caller discipline + size check). */
create or replace function app.audit(p_action text, p_target_type text, p_targets uuid[], p_purpose text,
  p_audience_change text default null, p_metadata jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from jsonb_object_keys(p_metadata) k
             where k ~* '(text|answer|body|summary|excerpt|question|content|token|secret|password|email|phone|transcript|note)') then
    raise exception 'audit metadata contains a forbidden key';
  end if;
  insert into public.audit_events (actor_user_id, action, target_type, target_ids, purpose, audience_change, metadata)
  values (auth.uid(), p_action, p_target_type, p_targets, p_purpose, p_audience_change, p_metadata);
end $$;

-- ===================================================================== RLS
do $$
declare t text;
begin
  foreach t in array array['profiles', 'staff_roles', 'athletes', 'guardian_invites', 'guardian_links', 'consent_records',
    'clubs', 'teams', 'memberships', 'activity_sessions', 'prompt_templates', 'prompt_versions', 'assignments',
    'reflections', 'voice_assets', 'focus_plans', 'focus_versions', 'coach_invites', 'coach_relationships',
    'loop_requests', 'feedback_drafts', 'coach_notes', 'feedback_publications', 'sharing_grants', 'profile_snapshots',
    'parent_briefs', 'notification_preferences', 'notification_jobs', 'concerns', 'blocks', 'sponsorships',
    'subscriptions', 'processed_stripe_events', 'audit_events', 'deletion_requests', 'rate_limits', 'ai_usage',
    'app_settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Read access only. Every write goes through a SECURITY DEFINER RPC with explicit checks.
grant usage on schema app to authenticated; -- execute grants are explicit (see final RPC migration)

grant select on public.profiles, public.staff_roles, public.athletes, public.guardian_links, public.consent_records,
  public.clubs, public.teams, public.memberships, public.activity_sessions, public.prompt_templates,
  public.prompt_versions, public.assignments, public.reflections, public.voice_assets, public.focus_plans,
  public.focus_versions, public.coach_relationships, public.loop_requests, public.feedback_drafts, public.coach_notes,
  public.feedback_publications, public.sharing_grants, public.profile_snapshots, public.parent_briefs,
  public.notification_preferences, public.notification_jobs, public.concerns, public.blocks, public.sponsorships,
  public.subscriptions, public.audit_events, public.deletion_requests
  to authenticated;
-- Invites: never expose token or email hashes, even to the creator.
grant select (id, athlete_id, intended_email_hint, expires_at, redeemed_at, revoked_at, created_at) on public.guardian_invites to authenticated;
grant select (id, athlete_id, coach_display_name, intended_email_hint, expires_at, redeemed_at, revoked_at, created_at) on public.coach_invites to authenticated;

-- RLS is not FORCEd: SECURITY DEFINER functions run as the table owner and perform their own explicit checks.
-- service_role bypasses RLS entirely; it is used only inside Edge Functions with explicit guards.

create policy profiles_read on public.profiles for select to authenticated using (app.can_see_profile(id));
create policy staff_roles_self on public.staff_roles for select to authenticated using (user_id = auth.uid());
create policy athletes_read on public.athletes for select to authenticated
  using (user_id = auth.uid() or app.is_active_guardian(id) or app.is_verified_coach(id));
create policy guardian_invites_read on public.guardian_invites for select to authenticated using (app.is_athlete_owner(athlete_id));
create policy guardian_links_read on public.guardian_links for select to authenticated
  using (app.is_athlete_owner(athlete_id) or guardian_user_id = auth.uid() or app.is_staff('verification_reviewer'));
create policy consent_read on public.consent_records for select to authenticated
  using (subject_user_id = auth.uid() or actor_user_id = auth.uid());
create policy clubs_read on public.clubs for select to authenticated using (app.is_tenant_member(tenant_id));
create policy teams_read on public.teams for select to authenticated using (app.is_team_member(id));
create policy memberships_read on public.memberships for select to authenticated
  using (user_id = auth.uid() or app.is_team_staff(team_id));
create policy sessions_read on public.activity_sessions for select to authenticated
  using ((athlete_id is not null and app.is_athlete_owner(athlete_id)) or (team_id is not null and app.is_team_member(team_id)));
create policy prompt_templates_read on public.prompt_templates for select to authenticated using (true);
create policy prompt_versions_read on public.prompt_versions for select to authenticated using (true);
create policy assignments_read on public.assignments for select to authenticated
  using (app.is_athlete_owner(athlete_id) or exists (
    select 1 from public.activity_sessions s where s.id = session_id and s.team_id is not null and app.is_team_staff(s.team_id)));
-- Private diary: owner only, plus explicit per-record coach_history grants to a currently verified coach.
create policy reflections_read on public.reflections for select to authenticated
  using (app.is_athlete_owner(athlete_id) or (state = 'submitted' and app.is_verified_coach(athlete_id) and exists (
    select 1 from public.sharing_grants g where g.record_type = 'reflection' and g.record_id = reflections.id
      and g.recipient_user_id = auth.uid() and g.surface = 'coach_history' and g.revoked_at is null)));
create policy voice_read on public.voice_assets for select to authenticated using (owner_user_id = auth.uid() and deleted_at is null);
create policy focus_plans_read on public.focus_plans for select to authenticated
  using (app.is_athlete_owner(athlete_id) or app.is_active_guardian(athlete_id) or app.is_verified_coach(athlete_id));
create policy focus_versions_read on public.focus_versions for select to authenticated
  using (app.is_athlete_owner(athlete_id)
    or (app.is_verified_coach(athlete_id) and ((accepted_at is not null and superseded_at is null) or author_id = auth.uid()))
    or (app.is_active_guardian(athlete_id) and accepted_at is not null and superseded_at is null));
create policy coach_invites_read on public.coach_invites for select to authenticated using (app.is_athlete_owner(athlete_id));
create policy coach_rel_read on public.coach_relationships for select to authenticated
  using (app.is_athlete_owner(athlete_id) or coach_user_id = auth.uid() or second_adult_user_id = auth.uid()
    or app.is_active_guardian(athlete_id) or app.is_staff('verification_reviewer'));
create policy loop_requests_read on public.loop_requests for select to authenticated
  using (app.is_athlete_owner(athlete_id) or app.is_verified_relationship_coach(coach_relationship_id)
    or app.is_audience_second_adult(athlete_id, audience));
create policy feedback_drafts_read on public.feedback_drafts for select to authenticated
  using (coach_id = auth.uid() and exists (select 1 from public.loop_requests q where q.id = request_id
    and app.is_verified_relationship_coach(q.coach_relationship_id)));
create policy coach_notes_read on public.coach_notes for select to authenticated using (coach_id = auth.uid());
create policy feedback_publications_read on public.feedback_publications for select to authenticated
  using (app.is_athlete_owner(athlete_id)
    or (coach_id = auth.uid() and app.is_verified_coach(athlete_id))
    or app.is_audience_second_adult(athlete_id, audience));
create policy sharing_read on public.sharing_grants for select to authenticated
  using (app.is_athlete_owner(owner_athlete_id) or recipient_user_id = auth.uid());
create policy snapshots_read on public.profile_snapshots for select to authenticated using (app.is_athlete_owner(athlete_id));
create policy briefs_read on public.parent_briefs for select to authenticated
  using ((author_coach_id = auth.uid() and app.is_verified_coach(athlete_id))
    or (state = 'published' and exists (select 1 from public.guardian_links g where g.id = guardian_link_id
        and g.guardian_user_id = auth.uid() and g.status = 'active' and g.revoked_at is null))
    or (state = 'published' and app.is_athlete_owner(athlete_id)));
create policy prefs_read on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy jobs_read on public.notification_jobs for select to authenticated using (recipient_user_id = auth.uid());
create policy concerns_read on public.concerns for select to authenticated
  using (reporter_user_id = auth.uid() or app.is_staff('safeguarding_owner'));
create policy blocks_read on public.blocks for select to authenticated using (blocker_user_id = auth.uid());
create policy sponsorships_read on public.sponsorships for select to authenticated
  using (app.is_athlete_owner(athlete_id) or app.is_active_guardian(athlete_id));
create policy subscriptions_read on public.subscriptions for select to authenticated
  using (payer_user_id = auth.uid() or app.is_athlete_owner(athlete_id));
create policy audit_read on public.audit_events for select to authenticated
  using (actor_user_id = auth.uid() or app.my_athlete_id() = any (target_ids)
    or app.is_staff('safeguarding_owner') or app.is_staff('support_admin'));
create policy deletion_read on public.deletion_requests for select to authenticated using (subject_user_id = auth.uid());
-- processed_stripe_events, rate_limits, ai_usage, app_settings: no policies => no client access.
