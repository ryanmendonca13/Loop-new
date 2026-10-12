-- Reflections, sessions, focus, coach loop requests, feedback publication, parent briefs, sharing.

create or replace function app.require_active_athlete() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_athlete uuid;
begin
  perform app.require_uid();
  select a.id into v_athlete from public.athletes a join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and a.activation_state = 'active' and p.account_state = 'active';
  if v_athlete is null then
    perform app.fail('account_not_active', 'Your account is not active yet. Diary content can be saved once activation is complete.');
  end if;
  return v_athlete;
end $$;

create or replace function app.core_prompt_version() returns uuid
language sql stable security definer set search_path = '' as $$
  select v.id from public.prompt_versions v join public.prompt_templates t on t.id = v.template_id
  where t.key = 'core-reflection' and v.locale = 'en' order by v.version desc limit 1
$$;

-- ------------------------------------------------------------------ sessions
create or replace function public.create_personal_session(p_title text, p_sport text, p_starts_at timestamptz,
  p_timezone text, p_next_session_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_session uuid; v_asg uuid;
begin
  insert into public.activity_sessions (athlete_id, title, sport, starts_at, timezone, reflection_due_at, next_session_at, author_id)
  values (v_athlete, trim(p_title), nullif(trim(p_sport), ''), p_starts_at, coalesce(p_timezone, 'UTC'), p_starts_at + interval '24 hours', p_next_session_at, auth.uid())
  returning id into v_session;
  insert into public.assignments (athlete_id, session_id, prompt_version_id, due_at, state)
  values (v_athlete, v_session, app.core_prompt_version(), p_starts_at + interval '24 hours', case when p_starts_at <= now() then 'open' else 'upcoming' end)
  returning id into v_asg;
  return jsonb_build_object('session_id', v_session, 'assignment_id', v_asg);
end $$;

/** Canceling a session cancels its assignments and pending reminders; excluded from completion. */
create or replace function public.cancel_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.activity_sessions;
begin
  perform app.require_uid();
  select * into v_s from public.activity_sessions where id = p_session_id for update;
  if v_s.id is null or not ((v_s.athlete_id is not null and app.is_athlete_owner(v_s.athlete_id)) or (v_s.team_id is not null and app.is_team_staff(v_s.team_id))) then
    perform app.fail('not_found', 'Session not found.');
  end if;
  if v_s.state <> 'scheduled' then perform app.fail('invalid_transition', 'activity_session: only scheduled sessions can be canceled'); end if;
  update public.activity_sessions set state = 'canceled' where id = p_session_id;
  update public.assignments set state = 'canceled' where session_id = p_session_id and state in ('upcoming', 'open', 'draft');
  update public.notification_jobs set state = 'canceled' where related_session_id = p_session_id and state = 'pending';
  perform app.audit('session.canceled', 'activity_session', array[p_session_id], 'schedule_change');
end $$;

create or replace function public.reschedule_session(p_session_id uuid, p_starts_at timestamptz, p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.activity_sessions;
begin
  perform app.require_uid();
  select * into v_s from public.activity_sessions where id = p_session_id for update;
  if v_s.id is null or not ((v_s.athlete_id is not null and app.is_athlete_owner(v_s.athlete_id)) or (v_s.team_id is not null and app.is_team_staff(v_s.team_id))) then
    perform app.fail('not_found', 'Session not found.');
  end if;
  if v_s.state <> 'scheduled' then perform app.fail('invalid_transition', 'Only scheduled sessions can be rescheduled.'); end if;
  if v_s.version <> p_version then perform app.fail('conflict', 'This session changed. Reload and try again.'); end if;
  update public.activity_sessions set starts_at = p_starts_at, reflection_due_at = p_starts_at + interval '24 hours' where id = p_session_id;
  update public.assignments set due_at = p_starts_at + interval '24 hours' where session_id = p_session_id and state in ('upcoming', 'open', 'draft');
  update public.notification_jobs set due_at = p_starts_at + interval '2 hours' where related_session_id = p_session_id and state = 'pending';
  perform app.audit('session.rescheduled', 'activity_session', array[p_session_id], 'schedule_change');
end $$;

-- ------------------------------------------------------------------ reflections (private diary)
create or replace function public.save_reflection_draft(p_reflection_id uuid, p_assignment_id uuid, p_answer_well text,
  p_answer_moment_back text, p_support_request text, p_mood smallint, p_expected_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_r public.reflections; v_id uuid; v_version integer;
begin
  if p_assignment_id is not null and not exists (select 1 from public.assignments where id = p_assignment_id and athlete_id = v_athlete) then
    perform app.fail('not_found', 'Assignment not found.');
  end if;
  if p_reflection_id is null then
    insert into public.reflections (athlete_id, assignment_id, prompt_version_id, answer_well, answer_moment_back, support_request, mood, author_id)
    values (v_athlete, p_assignment_id, app.core_prompt_version(), coalesce(p_answer_well, ''), coalesce(p_answer_moment_back, ''),
            nullif(trim(p_support_request), ''), p_mood, auth.uid())
    returning id, version into v_id, v_version;
    update public.assignments set state = 'draft' where id = p_assignment_id and state in ('upcoming', 'open');
  else
    select * into v_r from public.reflections where id = p_reflection_id and athlete_id = v_athlete for update;
    if v_r.id is null then perform app.fail('not_found', 'Reflection not found.'); end if;
    if v_r.state <> 'draft' then perform app.fail('invalid_transition', 'Submitted reflections are edited by creating a revision.'); end if;
    if p_expected_version is not null and v_r.version <> p_expected_version then
      perform app.fail('conflict', 'This draft was changed elsewhere. Reload to continue.');
    end if;
    update public.reflections set answer_well = coalesce(p_answer_well, ''), answer_moment_back = coalesce(p_answer_moment_back, ''),
      support_request = nullif(trim(p_support_request), ''), mood = p_mood
    where id = p_reflection_id returning id, version into v_id, v_version;
  end if;
  return jsonb_build_object('reflection_id', v_id, 'version', v_version);
end $$;

/** Idempotent submit: a retry/double tap with the same key returns the same reflection. */
create or replace function public.submit_reflection(p_reflection_id uuid, p_assignment_id uuid, p_answer_well text,
  p_answer_moment_back text, p_support_request text, p_mood smallint, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_existing uuid; v_id uuid;
begin
  select id into v_existing from public.reflections where athlete_id = v_athlete and idempotency_key = p_idempotency_key;
  if v_existing is not null then return jsonb_build_object('reflection_id', v_existing, 'duplicate', true); end if;
  if char_length(trim(coalesce(p_answer_well, ''))) = 0 or char_length(trim(coalesce(p_answer_moment_back, ''))) = 0 then
    perform app.fail('validation', 'Answer both prompts to submit.');
  end if;
  if p_reflection_id is not null then
    update public.reflections set answer_well = trim(p_answer_well), answer_moment_back = trim(p_answer_moment_back),
      support_request = nullif(trim(p_support_request), ''), mood = p_mood, state = 'submitted', submitted_at = now(),
      idempotency_key = p_idempotency_key
    where id = p_reflection_id and athlete_id = v_athlete and state = 'draft' returning id into v_id;
    if v_id is null then perform app.fail('not_found', 'Draft not found.'); end if;
  else
    insert into public.reflections (athlete_id, assignment_id, prompt_version_id, answer_well, answer_moment_back, support_request,
      mood, state, submitted_at, idempotency_key, author_id)
    values (v_athlete, p_assignment_id, app.core_prompt_version(), trim(p_answer_well), trim(p_answer_moment_back),
      nullif(trim(p_support_request), ''), p_mood, 'submitted', now(), p_idempotency_key, auth.uid())
    returning id into v_id;
  end if;
  update public.assignments set state = 'submitted'
  where id = (select assignment_id from public.reflections where id = v_id) and state in ('upcoming', 'open', 'draft');
  perform app.audit('reflection.submitted', 'reflection', array[v_id], 'diary');
  return jsonb_build_object('reflection_id', v_id, 'duplicate', false);
end $$;

/** Editing a submitted reflection creates a new revision. Shared request snapshots never change silently. */
create or replace function public.revise_reflection(p_reflection_id uuid, p_answer_well text, p_answer_moment_back text,
  p_support_request text, p_mood smallint, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_src public.reflections; v_id uuid;
begin
  select id into v_id from public.reflections where athlete_id = v_athlete and idempotency_key = p_idempotency_key;
  if v_id is not null then return jsonb_build_object('reflection_id', v_id, 'duplicate', true); end if;
  select * into v_src from public.reflections where id = p_reflection_id and athlete_id = v_athlete and state = 'submitted';
  if v_src.id is null then perform app.fail('not_found', 'Reflection not found.'); end if;
  insert into public.reflections (athlete_id, assignment_id, prompt_version_id, answer_well, answer_moment_back, support_request,
    mood, state, submitted_at, idempotency_key, revision_of, author_id)
  values (v_athlete, v_src.assignment_id, v_src.prompt_version_id, trim(p_answer_well), trim(p_answer_moment_back),
    nullif(trim(p_support_request), ''), p_mood, 'submitted', now(), p_idempotency_key, v_src.id, auth.uid())
  returning id into v_id;
  return jsonb_build_object('reflection_id', v_id, 'duplicate', false);
end $$;

-- ------------------------------------------------------------------ focus versions
create or replace function public.propose_focus(p_athlete_id uuid, p_now text, p_next_action text, p_next_situation text,
  p_next_measure text, p_north_star text, p_categories text[], p_source_ids uuid[], p_change_reason text,
  p_accept boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_plan uuid; v_id uuid; v_role text;
begin
  if app.is_athlete_owner(p_athlete_id) then
    perform app.require_active_athlete();
    v_role := 'athlete';
  elsif app.is_verified_coach(p_athlete_id) then
    v_role := 'coach';
  else
    perform app.fail('forbidden', 'Not allowed to propose a focus for this athlete.');
  end if;
  select id into v_plan from public.focus_plans where athlete_id = p_athlete_id;
  insert into public.focus_versions (focus_plan_id, athlete_id, now_text, next_action, next_situation, next_measure, north_star,
    categories, source_ids, author_id, author_role, change_reason)
  values (v_plan, p_athlete_id, trim(p_now), trim(p_next_action), trim(p_next_situation), trim(p_next_measure), nullif(trim(p_north_star), ''),
    coalesce(p_categories, '{}'), coalesce(p_source_ids, '{}'), v_uid, v_role, trim(p_change_reason))
  returning id into v_id;
  perform app.audit('focus.proposed', 'focus_version', array[v_id, p_athlete_id], 'focus', null, jsonb_build_object('author_role', v_role));
  -- Only the athlete can accept (explicitly). A coach proposal never silently changes NEXT or NORTH STAR.
  if p_accept and v_role = 'athlete' then perform public.accept_focus_version(v_id); end if;
  return jsonb_build_object('focus_version_id', v_id, 'accepted', p_accept and v_role = 'athlete');
end $$;

create or replace function public.accept_focus_version(p_focus_version_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_f public.focus_versions;
begin
  select * into v_f from public.focus_versions where id = p_focus_version_id and athlete_id = v_athlete for update;
  if v_f.id is null then perform app.fail('not_found', 'Focus version not found.'); end if;
  if v_f.accepted_at is not null or v_f.declined_at is not null then perform app.fail('invalid_transition', 'Already decided.'); end if;
  update public.focus_versions set superseded_at = now()
  where athlete_id = v_athlete and accepted_at is not null and superseded_at is null;
  update public.focus_versions set accepted_at = now(), accepted_by = auth.uid() where id = p_focus_version_id;
  perform app.audit('focus.accepted', 'focus_version', array[p_focus_version_id, v_athlete], 'focus');
end $$;

create or replace function public.decline_focus_version(p_focus_version_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete();
begin
  update public.focus_versions set declined_at = now()
  where id = p_focus_version_id and athlete_id = v_athlete and accepted_at is null and declined_at is null;
  if not found then perform app.fail('not_found', 'Focus version not found.'); end if;
  perform app.audit('focus.declined', 'focus_version', array[p_focus_version_id, v_athlete], 'focus');
end $$;

-- ------------------------------------------------------------------ Rule of Two gates and audience
create or replace function app.gate_failures(p_rel uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_rel public.coach_relationships; v_athlete public.athletes; v_band text; v_acct text; v_out text[] := '{}';
begin
  select * into v_rel from public.coach_relationships where id = p_rel;
  if v_rel.id is null then return array['coach_not_verified']; end if;
  select * into v_athlete from public.athletes where id = v_rel.athlete_id;
  select eligibility_band, account_state into v_band, v_acct from public.profiles where id = v_athlete.user_id;
  if v_athlete.activation_state <> 'active' or v_acct <> 'active' then v_out := array_append(v_out, 'account_not_active'); end if;
  if not (v_rel.active and v_rel.revoked_at is null and v_rel.verification_state = 'verified') then v_out := array_append(v_out, 'coach_not_verified'); end if;
  if not app.has_consent(v_athlete.user_id, 'coach_sharing') then v_out := array_append(v_out, 'coach_sharing_consent_missing'); end if;
  if v_band <> '18_plus' then
    if v_rel.second_adult_user_id is null then v_out := array_append(v_out, 'second_adult_missing');
    elsif not app.is_active_guardian(v_rel.athlete_id, v_rel.second_adult_user_id) then v_out := array_append(v_out, 'second_adult_not_linked_guardian');
    end if;
  end if;
  if exists (select 1 from public.blocks b where (b.blocker_user_id = v_athlete.user_id and b.blocked_user_id = v_rel.coach_user_id)) then
    v_out := array_append(v_out, 'coach_not_verified');
  end if;
  return v_out;
end $$;

create or replace function app.compute_audience(p_rel uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_members jsonb; v_rel public.coach_relationships;
begin
  select * into v_rel from public.coach_relationships where id = p_rel;
  select coalesce(jsonb_agg(m order by m ->> 'userId', m ->> 'role'), '[]'::jsonb) into v_members from (
    select jsonb_build_object('userId', a.user_id, 'displayName', p.display_name, 'role', 'athlete') m
      from public.athletes a join public.profiles p on p.id = a.user_id where a.id = v_rel.athlete_id
    union all
    select jsonb_build_object('userId', v_rel.coach_user_id, 'displayName', p.display_name, 'role', 'coach')
      from public.profiles p where p.id = v_rel.coach_user_id
    union all
    select jsonb_build_object('userId', v_rel.second_adult_user_id, 'displayName', p.display_name, 'role', 'second_adult')
      from public.profiles p where p.id = v_rel.second_adult_user_id and app.is_minor(v_rel.athlete_id)
  ) s;
  return jsonb_build_object('members', v_members,
    'hash', md5((select string_agg((e ->> 'userId') || ':' || (e ->> 'role'), ',' order by e ->> 'userId', e ->> 'role') from jsonb_array_elements(v_members) e)),
    'capturedAt', now());
end $$;

/** Shown before submission/publication: exactly who will see the shared exchange, plus any gate failures. */
create or replace function public.preview_exchange_audience(p_rel_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rel public.coach_relationships;
begin
  perform app.require_uid();
  select * into v_rel from public.coach_relationships where id = p_rel_id;
  if v_rel.id is null or not (app.is_athlete_owner(v_rel.athlete_id) or app.is_verified_relationship_coach(p_rel_id)) then
    perform app.fail('not_found', 'Relationship not found.');
  end if;
  return app.compute_audience(p_rel_id) || jsonb_build_object('gate_failures', to_jsonb(app.gate_failures(p_rel_id)));
end $$;

-- ------------------------------------------------------------------ loop requests
create or replace function public.create_loop_request(p_reflection_id uuid, p_rel_id uuid, p_shared_excerpt text,
  p_question text, p_confirmed_audience_hash text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_athlete uuid := app.require_active_athlete();
  v_existing uuid; v_rel public.coach_relationships; v_gates text[]; v_aud jsonb; v_id uuid;
  v_session uuid; v_next timestamptz; v_due timestamptz;
  v_window interval := coalesce((select (value #>> '{}')::interval from public.app_settings where key = 'response_window'), interval '48 hours');
begin
  select id into v_existing from public.loop_requests where athlete_id = v_athlete and idempotency_key = p_idempotency_key;
  if v_existing is not null then return jsonb_build_object('request_id', v_existing, 'duplicate', true); end if;
  select * into v_rel from public.coach_relationships where id = p_rel_id and athlete_id = v_athlete;
  if v_rel.id is null then perform app.fail('not_found', 'Coach not found.'); end if;
  v_gates := app.gate_failures(p_rel_id);
  if cardinality(v_gates) > 0 then
    perform app.fail(case when v_gates && array['second_adult_missing', 'second_adult_not_linked_guardian'] then 'second_adult_required'
                          when 'coach_not_verified' = any (v_gates) then 'coach_not_verified' else 'forbidden' end,
                     array_to_string(v_gates, ','));
  end if;
  if not exists (select 1 from public.reflections where id = p_reflection_id and athlete_id = v_athlete and state = 'submitted') then
    perform app.fail('not_found', 'Submit the reflection before sharing it.');
  end if;
  if char_length(trim(coalesce(p_shared_excerpt, ''))) not between 1 and 600 or char_length(trim(coalesce(p_question, ''))) not between 1 and 300 then
    perform app.fail('validation', 'Excerpt (max 600) and question (max 300) are required.');
  end if;
  v_aud := app.compute_audience(p_rel_id);
  if v_aud ->> 'hash' <> p_confirmed_audience_hash then
    perform app.fail('stale_review', 'Who can see this request has changed. Review the audience again.');
  end if;
  select s.id, s.next_session_at into v_session, v_next from public.reflections r
    left join public.assignments a on a.id = r.assignment_id left join public.activity_sessions s on s.id = a.session_id
    where r.id = p_reflection_id;
  v_due := case when v_next > now() then v_next else now() + v_window end;
  begin
    insert into public.loop_requests (athlete_id, reflection_id, session_id, coach_relationship_id, shared_excerpt, question,
      audience, audience_hash, next_session_at, due_at, state, idempotency_key)
    values (v_athlete, p_reflection_id, v_session, p_rel_id, trim(p_shared_excerpt), trim(p_question),
      v_aud, v_aud ->> 'hash', v_next, v_due, 'queued', p_idempotency_key)
    returning id into v_id;
  exception when unique_violation then
    perform app.fail('active_request_exists', 'You already have an open coach request. Wait for it, or cancel it first.');
  end;
  update public.loop_requests set state = 'waiting_for_coach' where id = v_id;
  perform app.enqueue_in_app(v_rel.coach_user_id, 'coach_request_waiting', 'An athlete is waiting for your feedback', '/coach', 'req-waiting:' || v_id);
  perform app.audit('loop_request.created', 'loop_request', array[v_id, v_athlete], 'coach_exchange', 'shared_with_audience',
    jsonb_build_object('audience_hash', v_aud ->> 'hash'));
  return jsonb_build_object('request_id', v_id, 'duplicate', false, 'due_at', v_due);
end $$;

create or replace function public.cancel_loop_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_uid();
  update public.loop_requests set state = 'canceled'
  where id = p_request_id and app.is_athlete_owner(athlete_id) and state in ('queued', 'waiting_for_coach', 'response_draft');
  if not found then perform app.fail('invalid_transition', 'Only open requests can be canceled.'); end if;
  perform app.audit('loop_request.canceled', 'loop_request', array[p_request_id], 'coach_exchange');
end $$;

create or replace function app.coach_request_for_update(p_request_id uuid) returns public.loop_requests
language plpgsql security definer set search_path = '' as $$
declare v_q public.loop_requests;
begin
  select * into v_q from public.loop_requests where id = p_request_id for update;
  if v_q.id is null or not app.is_verified_relationship_coach(v_q.coach_relationship_id) then
    perform app.fail('not_found', 'Request not found.');
  end if;
  return v_q;
end $$;

create or replace function public.coach_save_draft(p_request_id uuid, p_summary text, p_one_next_action text,
  p_situation text, p_measure text, p_expected_version integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_q public.loop_requests; v_d public.feedback_drafts; v_id uuid; v_ver integer;
begin
  v_q := app.coach_request_for_update(p_request_id);
  if v_q.state not in ('waiting_for_coach', 'response_draft') then perform app.fail('invalid_transition', 'This request is no longer open.'); end if;
  select * into v_d from public.feedback_drafts where request_id = p_request_id and coach_id = v_uid for update;
  if v_d.id is null then
    insert into public.feedback_drafts (request_id, coach_id, summary, one_next_action, situation, measure)
    values (p_request_id, v_uid, coalesce(p_summary, ''), coalesce(p_one_next_action, ''), coalesce(p_situation, ''), coalesce(p_measure, ''))
    returning id, version into v_id, v_ver;
  else
    if p_expected_version is not null and v_d.version <> p_expected_version then perform app.fail('conflict', 'Draft changed elsewhere. Reload.'); end if;
    if v_d.state = 'published' then perform app.fail('invalid_transition', 'Already published. Publish a correction instead.'); end if;
    -- Any edit invalidates a previous review.
    update public.feedback_drafts set summary = coalesce(p_summary, ''), one_next_action = coalesce(p_one_next_action, ''),
      situation = coalesce(p_situation, ''), measure = coalesce(p_measure, ''), state = 'manual_draft',
      reviewed_audience_hash = null, reviewed_version = null
    where id = v_d.id returning id, version into v_id, v_ver;
  end if;
  if v_q.state = 'waiting_for_coach' then update public.loop_requests set state = 'response_draft' where id = p_request_id; end if;
  return jsonb_build_object('draft_id', v_id, 'version', v_ver);
end $$;

/** Authorized, minimal AI sources for ONE request (shared snapshot + current focus). Used by the ai-draft Edge Function. */
create or replace function public.coach_ai_sources(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_q public.loop_requests; v_focus text;
begin
  perform app.require_uid();
  select * into v_q from public.loop_requests where id = p_request_id;
  if v_q.id is null or not app.is_verified_relationship_coach(v_q.coach_relationship_id) then perform app.fail('not_found', 'Request not found.'); end if;
  select now_text into v_focus from public.focus_versions where athlete_id = v_q.athlete_id and accepted_at is not null and superseded_at is null;
  return jsonb_build_object('athlete_id', v_q.athlete_id, 'focus_now', v_focus, 'sources', jsonb_build_array(
    jsonb_build_object('id', v_q.id, 'kind', 'request_question', 'text', v_q.question),
    jsonb_build_object('id', v_q.reflection_id, 'kind', 'reflection_excerpt', 'text', v_q.shared_excerpt)));
end $$;

create or replace function public.coach_store_ai_suggestion(p_request_id uuid, p_summary text, p_one_next_action text,
  p_situation text, p_measure text, p_source_ids uuid[], p_model text, p_prompt_version text, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_q public.loop_requests; v_d uuid; v_ver integer;
begin
  v_q := app.coach_request_for_update(p_request_id);
  insert into public.ai_usage (actor_user_id, request_id, model, prompt_version, outcome) values (v_uid, p_request_id, p_model, p_prompt_version, p_outcome);
  if p_outcome <> 'ok' then return jsonb_build_object('stored', false, 'outcome', p_outcome); end if;
  if not (p_source_ids <@ array[v_q.id, v_q.reflection_id]) then perform app.fail('forbidden', 'AI used unauthorized sources.'); end if;
  insert into public.feedback_drafts (request_id, coach_id, summary, one_next_action, situation, measure, ai_source_ids, ai_model, ai_prompt_version, state)
  values (p_request_id, v_uid, coalesce(p_summary, ''), coalesce(p_one_next_action, ''), coalesce(p_situation, ''), coalesce(p_measure, ''),
    p_source_ids, p_model, p_prompt_version, 'ai_suggested')
  on conflict (request_id, coach_id) do update set summary = excluded.summary, one_next_action = excluded.one_next_action,
    situation = excluded.situation, measure = excluded.measure, ai_source_ids = excluded.ai_source_ids, ai_model = excluded.ai_model,
    ai_prompt_version = excluded.ai_prompt_version, state = 'ai_suggested', reviewed_audience_hash = null, reviewed_version = null
    where public.feedback_drafts.state <> 'published'
  returning id, version into v_d, v_ver;
  if v_q.state = 'waiting_for_coach' then update public.loop_requests set state = 'response_draft' where id = p_request_id; end if;
  return jsonb_build_object('stored', true, 'draft_id', v_d, 'version', v_ver);
end $$;

/** Coach confirms recipient/content/audience. Records which version and audience were reviewed. */
create or replace function public.coach_mark_reviewed(p_draft_id uuid, p_expected_version integer, p_confirmed_audience_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_d public.feedback_drafts; v_q public.loop_requests; v_aud jsonb; v_ver integer;
begin
  select * into v_d from public.feedback_drafts where id = p_draft_id and coach_id = v_uid for update;
  if v_d.id is null then perform app.fail('not_found', 'Draft not found.'); end if;
  v_q := app.coach_request_for_update(v_d.request_id);
  if v_d.version <> p_expected_version then perform app.fail('stale_review', 'The draft changed. Review the latest version.'); end if;
  if char_length(trim(v_d.one_next_action)) = 0 or char_length(trim(v_d.situation)) = 0 or char_length(trim(v_d.measure)) = 0 then
    perform app.fail('validation', 'One action, one situation and a simple measure are required.');
  end if;
  v_aud := app.compute_audience(v_q.coach_relationship_id);
  if v_aud ->> 'hash' <> p_confirmed_audience_hash then perform app.fail('stale_review', 'The audience changed. Review again.'); end if;
  update public.feedback_drafts set state = 'reviewed', reviewed_audience_hash = p_confirmed_audience_hash, reviewed_version = v_d.version + 1
  where id = p_draft_id returning version into v_ver;
  return jsonb_build_object('draft_id', p_draft_id, 'version', v_ver);
end $$;

/**
 * Publication: one transaction, fresh authorization + Rule-of-Two check, reviewed version and audience must
 * still match, idempotent on key, at most one current publication per request.
 */
create or replace function public.publish_feedback(p_draft_id uuid, p_draft_version integer, p_confirmed_audience_hash text,
  p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_uid();
  v_existing uuid; v_d public.feedback_drafts; v_q public.loop_requests; v_gates text[]; v_aud jsonb; v_pub uuid; m jsonb;
begin
  select id into v_existing from public.feedback_publications where publish_idempotency_key = p_idempotency_key and coach_id = v_uid;
  if v_existing is not null then return jsonb_build_object('publication_id', v_existing, 'duplicate', true); end if;
  select * into v_d from public.feedback_drafts where id = p_draft_id and coach_id = v_uid for update;
  if v_d.id is null then perform app.fail('not_found', 'Draft not found.'); end if;
  v_q := app.coach_request_for_update(v_d.request_id);
  if v_q.state <> 'response_draft' then perform app.fail('invalid_transition', 'This request cannot be published now.'); end if;
  if v_d.state <> 'reviewed' or v_d.reviewed_version is distinct from v_d.version or v_d.version <> p_draft_version then
    perform app.fail('stale_review', 'Review the latest draft before publishing.');
  end if;
  v_gates := app.gate_failures(v_q.coach_relationship_id);
  if cardinality(v_gates) > 0 then perform app.fail('second_adult_required', array_to_string(v_gates, ',')); end if;
  v_aud := app.compute_audience(v_q.coach_relationship_id);
  if v_aud ->> 'hash' <> p_confirmed_audience_hash or v_d.reviewed_audience_hash <> p_confirmed_audience_hash then
    perform app.fail('stale_review', 'The audience changed since review. Review again.');
  end if;
  insert into public.feedback_publications (request_id, athlete_id, coach_id, draft_id, summary, one_next_action, situation, measure,
    approved_by, audience, audience_hash, publish_idempotency_key)
  values (v_q.id, v_q.athlete_id, v_uid, v_d.id, v_d.summary, v_d.one_next_action, v_d.situation, v_d.measure,
    v_uid, v_aud, v_aud ->> 'hash', p_idempotency_key)
  returning id into v_pub;
  update public.feedback_drafts set state = 'published' where id = v_d.id;
  update public.loop_requests set state = 'published' where id = v_q.id;
  for m in select * from jsonb_array_elements(v_aud -> 'members') loop
    if m ->> 'role' in ('athlete', 'second_adult') then
      perform app.enqueue_in_app((m ->> 'userId')::uuid, 'coach_responded', 'You have new feedback in Loop',
        case when m ->> 'role' = 'athlete' then '/feedback' else '/guardian' end, 'published:' || v_pub || ':' || (m ->> 'userId'));
    end if;
  end loop;
  perform app.audit('feedback.published', 'feedback_publication', array[v_pub, v_q.id, v_q.athlete_id], 'coach_exchange',
    'published_to_audience', jsonb_build_object('audience_hash', v_aud ->> 'hash'));
  return jsonb_build_object('publication_id', v_pub, 'duplicate', false);
end $$;

/** Corrections supersede (never silently overwrite) the current publication. */
create or replace function public.correct_publication(p_publication_id uuid, p_summary text, p_one_next_action text,
  p_situation text, p_measure text, p_confirmed_audience_hash text, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_p public.feedback_publications; v_q public.loop_requests; v_aud jsonb; v_new uuid; v_gates text[];
begin
  select id into v_new from public.feedback_publications where publish_idempotency_key = p_idempotency_key and coach_id = v_uid;
  if v_new is not null then return jsonb_build_object('publication_id', v_new, 'duplicate', true); end if;
  select * into v_p from public.feedback_publications where id = p_publication_id and coach_id = v_uid and is_current for update;
  if v_p.id is null then perform app.fail('not_found', 'Publication not found.'); end if;
  v_q := app.coach_request_for_update(v_p.request_id);
  v_gates := app.gate_failures(v_q.coach_relationship_id);
  if cardinality(v_gates) > 0 then perform app.fail('second_adult_required', array_to_string(v_gates, ',')); end if;
  v_aud := app.compute_audience(v_q.coach_relationship_id);
  if v_aud ->> 'hash' <> p_confirmed_audience_hash then perform app.fail('stale_review', 'The audience changed. Review again.'); end if;
  update public.feedback_publications set is_current = false where id = v_p.id;
  insert into public.feedback_publications (request_id, athlete_id, coach_id, draft_id, summary, one_next_action, situation, measure,
    approved_by, audience, audience_hash, corrected_from_id, version, publish_idempotency_key)
  values (v_p.request_id, v_p.athlete_id, v_uid, v_p.draft_id, trim(p_summary), trim(p_one_next_action), trim(p_situation), trim(p_measure),
    v_uid, v_aud, v_aud ->> 'hash', v_p.id, v_p.version + 1, p_idempotency_key)
  returning id into v_new;
  perform app.audit('feedback.corrected', 'feedback_publication', array[v_new, v_p.id], 'coach_exchange', 'correction_published');
  return jsonb_build_object('publication_id', v_new, 'duplicate', false);
end $$;

create or replace function public.decline_loop_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_q public.loop_requests;
begin
  perform app.require_uid();
  v_q := app.coach_request_for_update(p_request_id);
  if v_q.state not in ('waiting_for_coach', 'response_draft') then perform app.fail('invalid_transition', 'Request is not open.'); end if;
  update public.loop_requests set state = 'declined' where id = p_request_id;
  update public.feedback_drafts set state = 'rejected' where request_id = p_request_id and state <> 'published';
  perform app.enqueue_in_app((select user_id from public.athletes where id = v_q.athlete_id), 'system', 'Your coach could not respond to this request', '/', 'declined:' || p_request_id);
  perform app.audit('loop_request.declined', 'loop_request', array[p_request_id], 'coach_exchange');
end $$;

create or replace function public.acknowledge_feedback(p_request_id uuid, p_close boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_state text;
begin
  select state into v_state from public.loop_requests where id = p_request_id and athlete_id = v_athlete for update;
  if v_state is null then perform app.fail('not_found', 'Request not found.'); end if;
  if v_state = 'published' then
    update public.loop_requests set state = case when p_close then 'closed' else 'athlete_acknowledged' end where id = p_request_id;
  elsif v_state = 'athlete_acknowledged' and p_close then
    update public.loop_requests set state = 'closed' where id = p_request_id;
  else
    perform app.fail('invalid_transition', 'Only published feedback can be acknowledged.');
  end if;
  perform app.audit('loop_request.acknowledged', 'loop_request', array[p_request_id], 'coach_exchange');
end $$;

/** Scheduled job (service role only): expiry frees the active slot but never fabricates closure. */
create or replace function public.expire_due_requests() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.loop_requests set state = 'expired'
  where state in ('queued', 'waiting_for_coach', 'response_draft') and due_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.expire_due_requests() from public, anon, authenticated;

-- ------------------------------------------------------------------ parent briefs (reviewed support cues)
create or replace function public.coach_create_brief(p_athlete_id uuid, p_guardian_link_id uuid, p_something_to_say text,
  p_question_to_ask text, p_habit_to_praise text, p_source_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_id uuid; v_link uuid := p_guardian_link_id;
begin
  if not app.is_verified_coach(p_athlete_id) then perform app.fail('forbidden', 'Verified coach required.'); end if;
  if v_link is null then
    -- Coaches cannot read guardian links; resolve the active link of this coach relationship's second adult.
    select g.id into v_link from public.coach_relationships r join public.guardian_links g
      on g.athlete_id = r.athlete_id and g.guardian_user_id = r.second_adult_user_id and g.status = 'active'
    where r.athlete_id = p_athlete_id and r.coach_user_id = v_uid and r.active limit 1;
  end if;
  if not exists (select 1 from public.guardian_links where id = v_link and athlete_id = p_athlete_id and status = 'active') then
    perform app.fail('forbidden', 'Briefs go only to a verified linked guardian.');
  end if;
  if (coalesce(p_something_to_say, '') || coalesce(p_question_to_ask, '') || coalesce(p_habit_to_praise, '')) ~ '["“”]' then
    perform app.fail('validation', 'Briefs cannot include quotes from the athlete.');
  end if;
  insert into public.parent_briefs (athlete_id, guardian_link_id, author_coach_id, something_to_say, question_to_ask, habit_to_praise, source_ids)
  values (p_athlete_id, v_link, v_uid, trim(p_something_to_say), trim(p_question_to_ask), trim(p_habit_to_praise), coalesce(p_source_ids, '{}'))
  returning id into v_id;
  return jsonb_build_object('brief_id', v_id);
end $$;

create or replace function public.coach_advance_brief(p_brief_id uuid, p_action text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_b public.parent_briefs; v_guardian uuid;
begin
  select * into v_b from public.parent_briefs where id = p_brief_id and author_coach_id = v_uid for update;
  if v_b.id is null or not app.is_verified_coach(v_b.athlete_id) then perform app.fail('not_found', 'Brief not found.'); end if;
  if p_action = 'review' and v_b.state = 'draft' then
    update public.parent_briefs set state = 'coach_reviewed', reviewed_by = v_uid, reviewed_at = now() where id = p_brief_id;
  elsif p_action = 'publish' and v_b.state = 'coach_reviewed' then
    select guardian_user_id into v_guardian from public.guardian_links where id = v_b.guardian_link_id and status = 'active';
    if v_guardian is null then perform app.fail('forbidden', 'Guardian link is no longer active.'); end if;
    update public.parent_briefs set state = 'published', published_at = now() where id = p_brief_id;
    perform app.enqueue_in_app(v_guardian, 'brief_published', 'A new support cue is available', '/guardian', 'brief:' || p_brief_id);
  elsif p_action = 'revoke' and v_b.state = 'published' then
    update public.parent_briefs set state = 'revoked' where id = p_brief_id;
  else
    perform app.fail('invalid_transition', 'parent_brief: invalid transition');
  end if;
  perform app.audit('parent_brief.' || p_action, 'parent_brief', array[p_brief_id, v_b.athlete_id], 'guardian_cues');
end $$;

-- ------------------------------------------------------------------ sharing grants
create or replace function public.grant_share(p_record_type text, p_record_id uuid, p_recipient uuid, p_surface text, p_purpose text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_rel uuid; v_id uuid;
begin
  if p_record_type = 'reflection' and not exists (select 1 from public.reflections where id = p_record_id and athlete_id = v_athlete and state = 'submitted') then
    perform app.fail('not_found', 'Record not found.');
  end if;
  if p_surface in ('coach_history', 'coach_request') then
    select id into v_rel from public.coach_relationships where athlete_id = v_athlete and coach_user_id = p_recipient
      and active and verification_state = 'verified';
    if v_rel is null then perform app.fail('coach_not_verified', 'Only a verified coach can receive shared records.'); end if;
  elsif p_surface = 'guardian_cues' then
    if not app.is_active_guardian(v_athlete, p_recipient) then perform app.fail('forbidden', 'Only an active linked guardian.'); end if;
  else
    perform app.fail('validation', 'Unknown surface.');
  end if;
  insert into public.sharing_grants (record_type, record_id, owner_athlete_id, recipient_user_id, relationship_id, surface, purpose)
  values (p_record_type, p_record_id, v_athlete, p_recipient, v_rel, p_surface, p_purpose)
  on conflict do nothing returning id into v_id;
  perform app.audit('share.granted', p_record_type, array[p_record_id, v_athlete], p_purpose, 'grant:' || p_surface);
  return jsonb_build_object('grant_id', v_id);
end $$;

/** Revocation blocks new reads immediately. Content already viewed or downloaded cannot be recalled. */
create or replace function public.revoke_share(p_grant_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_g public.sharing_grants;
begin
  perform app.require_uid();
  update public.sharing_grants set revoked_at = now()
  where id = p_grant_id and app.is_athlete_owner(owner_athlete_id) and revoked_at is null returning * into v_g;
  if v_g.id is null then perform app.fail('not_found', 'Grant not found.'); end if;
  perform app.audit('share.revoked', v_g.record_type, array[v_g.record_id, v_g.owner_athlete_id], v_g.purpose, 'revoke:' || v_g.surface);
end $$;
