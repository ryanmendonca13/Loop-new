-- Notification preferences, safeguarding concerns/blocks, export/deletion, voice storage, billing reconciliation.

create or replace function public.update_notification_preferences(p_in_app boolean, p_email_reminders boolean,
  p_quiet_start smallint, p_quiet_end smallint) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid();
begin
  if p_email_reminders and not app.has_consent(v_uid, 'email_notifications') then
    perform app.fail('consent_required', 'Turn on email consent first.');
  end if;
  insert into public.notification_preferences (user_id, in_app_enabled, email_reminders, quiet_hours_start, quiet_hours_end)
  values (v_uid, p_in_app, p_email_reminders, p_quiet_start, p_quiet_end)
  on conflict (user_id) do update set in_app_enabled = excluded.in_app_enabled, email_reminders = excluded.email_reminders,
    quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end, updated_at = now();
  if not p_email_reminders then
    update public.notification_jobs set state = 'canceled' where recipient_user_id = v_uid and channel = 'email' and state = 'pending';
  end if;
end $$;

create or replace function public.mark_notification_read(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_jobs set read_at = coalesce(read_at, now()) where id = p_id and recipient_user_id = app.require_uid();
end $$;

-- ------------------------------------------------------------------ safeguarding
/** Restricted concern report. Routed to the configured safeguarding owner; no autonomous decisions. */
create or replace function public.report_concern(p_description text, p_subject_athlete_id uuid, p_reference_type text, p_reference_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_owner uuid; v_id uuid;
begin
  perform app.rate_limit('concern', 10, interval '1 day');
  select (value #>> '{}')::uuid into v_owner from public.app_settings where key = 'safeguarding_owner_user_id';
  insert into public.concerns (reporter_user_id, subject_athlete_id, reference_type, reference_id, assigned_safeguarding_owner, description)
  values (v_uid, p_subject_athlete_id, p_reference_type, p_reference_id, v_owner, trim(p_description))
  returning id into v_id;
  perform app.audit('concern.reported', 'concern', array[v_id], 'safeguarding');
  if v_owner is not null then
    perform app.enqueue_in_app(v_owner, 'system', 'A concern report needs review', '/admin', 'concern:' || v_id);
  end if;
  return jsonb_build_object('concern_id', v_id, 'routed', v_owner is not null);
end $$;

create or replace function public.triage_concern(p_concern_id uuid, p_state text, p_severity text, p_evidence_ref text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_staff('safeguarding_owner') then perform app.fail('forbidden', 'Safeguarding owner with MFA required.'); end if;
  update public.concerns set state = p_state, severity = p_severity, evidence_ref = coalesce(p_evidence_ref, evidence_ref)
  where id = p_concern_id;
  if not found then perform app.fail('not_found', 'Concern not found.'); end if;
  perform app.audit('concern.triaged', 'concern', array[p_concern_id], 'safeguarding', null, jsonb_build_object('state', p_state, 'severity', p_severity));
end $$;

create or replace function public.block_user(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_athlete uuid := app.my_athlete_id(); v_rel uuid;
begin
  insert into public.blocks (blocker_user_id, blocked_user_id) values (v_uid, p_user_id) on conflict do nothing;
  if v_athlete is not null then
    for v_rel in select id from public.coach_relationships where athlete_id = v_athlete and coach_user_id = p_user_id and active loop
      perform public.revoke_coach_relationship(v_rel);
    end loop;
  end if;
  perform app.audit('user.blocked', 'profile', array[p_user_id], 'safety');
end $$;

-- ------------------------------------------------------------------ data rights
/** Export ONLY the authenticated subject's own records (no other people's private notes or drafts). */
create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_athlete uuid := app.my_athlete_id();
begin
  perform app.rate_limit('export', 5, interval '1 day');
  perform app.audit('data.exported', 'profile', array[v_uid], 'data_rights');
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v_uid),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.consent_records c where c.subject_user_id = v_uid or c.actor_user_id = v_uid),
    'notification_preferences', (select to_jsonb(n) from public.notification_preferences n where n.user_id = v_uid),
    'guardian_links', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'athlete_id', g.athlete_id, 'status', g.status, 'verified_at', g.verified_at, 'revoked_at', g.revoked_at)), '[]')
      from public.guardian_links g where g.guardian_user_id = v_uid or g.athlete_id = v_athlete),
    'reflections', (select coalesce(jsonb_agg(to_jsonb(r) - 'idempotency_key'), '[]') from public.reflections r where r.athlete_id = v_athlete),
    'focus_versions', (select coalesce(jsonb_agg(to_jsonb(f)), '[]') from public.focus_versions f where f.athlete_id = v_athlete),
    'loop_requests', (select coalesce(jsonb_agg(to_jsonb(q) - 'idempotency_key'), '[]') from public.loop_requests q where q.athlete_id = v_athlete),
    'feedback_received', (select coalesce(jsonb_agg(to_jsonb(f) - 'publish_idempotency_key'), '[]') from public.feedback_publications f where f.athlete_id = v_athlete),
    'feedback_given', (select coalesce(jsonb_agg(to_jsonb(f) - 'publish_idempotency_key'), '[]') from public.feedback_publications f where f.coach_id = v_uid),
    'voice_assets', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'created_at', v.created_at, 'retention_state', v.retention_state, 'transcript_state', v.transcript_state)), '[]')
      from public.voice_assets v where v.owner_user_id = v_uid),
    'sharing_grants', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.sharing_grants s where s.owner_athlete_id = v_athlete),
    'parent_briefs_about_me', (select coalesce(jsonb_agg(to_jsonb(b)), '[]') from public.parent_briefs b where b.athlete_id = v_athlete and b.state = 'published')
  );
end $$;

create or replace function public.request_deletion(p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := app.require_uid(); v_id uuid;
begin
  insert into public.deletion_requests (subject_user_id, requested_by, scope) values (v_uid, v_uid, p_scope) returning id into v_id;
  if p_scope = 'voice_only' then
    update public.voice_assets set retention_state = 'delete_pending' where owner_user_id = v_uid and retention_state = 'active';
  end if;
  perform app.audit('deletion.requested', 'deletion_request', array[v_id], 'data_rights', null, jsonb_build_object('scope', p_scope));
  return jsonb_build_object('deletion_request_id', v_id, 'state', 'requested');
end $$;

/**
 * Executes an approved deletion (service role only, from the data-rights Edge Function, which also deletes
 * storage objects and the auth user). Deletes diary, audio metadata and derived outputs. The audit trail keeps
 * only identifiers/states, never the deleted content.
 */
create or replace function public.process_deletion(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_req public.deletion_requests; v_athlete uuid; v_paths text[];
begin
  select * into v_req from public.deletion_requests where id = p_request_id and state in ('requested', 'in_review') for update;
  if v_req.id is null then perform app.fail('not_found', 'Deletion request not found.'); end if;
  select id into v_athlete from public.athletes where user_id = v_req.subject_user_id;
  select coalesce(array_agg(storage_path), '{}') into v_paths from public.voice_assets where owner_user_id = v_req.subject_user_id;
  update public.voice_assets set retention_state = 'deleted', deleted_at = now(), transcript_draft = null where owner_user_id = v_req.subject_user_id;
  if v_req.scope in ('reflections', 'account') and v_athlete is not null then
    perform set_config('app.allow_erasure', 'on', true);
    delete from public.profile_snapshots where athlete_id = v_athlete;
    delete from public.feedback_publications where athlete_id = v_athlete;
    delete from public.feedback_drafts where request_id in (select id from public.loop_requests where athlete_id = v_athlete);
    delete from public.loop_requests where athlete_id = v_athlete;
    delete from public.sharing_grants where owner_athlete_id = v_athlete and record_type = 'reflection';
    update public.reflections set revision_of = null where athlete_id = v_athlete;
    delete from public.reflections where athlete_id = v_athlete;
    delete from public.ai_usage where actor_user_id = v_req.subject_user_id;
  end if;
  if v_req.scope = 'account' then
    delete from public.voice_assets where owner_user_id = v_req.subject_user_id;
    update public.deletion_requests set state = 'completed', completed_at = now() where id = p_request_id;
    insert into public.audit_events (actor_user_id, action, target_type, target_ids, purpose)
    values (null, 'deletion.completed', 'deletion_request', array[p_request_id], 'data_rights');
    -- Profile row (and cascades) is removed when the Edge Function deletes the auth user.
  else
    update public.deletion_requests set state = 'completed', completed_at = now() where id = p_request_id;
    insert into public.audit_events (actor_user_id, action, target_type, target_ids, purpose, metadata)
    values (null, 'deletion.completed', 'deletion_request', array[p_request_id], 'data_rights', jsonb_build_object('scope', v_req.scope));
  end if;
  return jsonb_build_object('storage_paths', to_jsonb(v_paths), 'subject_user_id', v_req.subject_user_id, 'scope', v_req.scope);
end $$;
revoke execute on function public.process_deletion(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ voice (optional, separately consented)
insert into storage.buckets (id, name, public) values ('voice', 'voice', false) on conflict (id) do nothing;

-- Owner-only private folder: voice/<auth uid>/<file>. No public URLs; signed URLs are short-lived and issued after auth.
create policy voice_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text
    and app.has_consent(auth.uid(), 'voice_recording') and app.require_active_athlete() is not null);
create policy voice_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);
create policy voice_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'voice' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.register_voice_asset(p_storage_path text, p_reflection_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_athlete uuid := app.require_active_athlete(); v_consent uuid; v_id uuid;
begin
  select id into v_consent from public.consent_records where subject_user_id = auth.uid() and purpose = 'voice_recording' and withdrawn_at is null limit 1;
  if v_consent is null then perform app.fail('consent_required', 'Voice recording needs separate consent.'); end if;
  if split_part(p_storage_path, '/', 1) <> auth.uid()::text then perform app.fail('forbidden', 'Invalid storage path.'); end if;
  if p_reflection_id is not null and not exists (select 1 from public.reflections where id = p_reflection_id and athlete_id = v_athlete) then
    perform app.fail('not_found', 'Reflection not found.');
  end if;
  insert into public.voice_assets (owner_user_id, reflection_id, storage_path, consent_record_id)
  values (auth.uid(), p_reflection_id, p_storage_path, v_consent) returning id into v_id;
  return jsonb_build_object('voice_asset_id', v_id);
end $$;

-- ------------------------------------------------------------------ billing (service role from stripe-webhook only)
/** Records a verified Stripe event id; returns false when already processed (dedupe). */
create or replace function public.billing_record_event(p_event_id text, p_type text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.processed_stripe_events (event_id, type) values (p_event_id, p_type);
  return true;
exception when unique_violation then
  return false;
end $$;
revoke execute on function public.billing_record_event(text, text) from public, anon, authenticated;

create or replace function public.billing_upsert_subscription(p_stripe_subscription_id text, p_customer_id text, p_payer uuid,
  p_athlete uuid, p_status text, p_event_created bigint, p_period_end timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_prev public.subscriptions;
begin
  select * into v_prev from public.subscriptions where stripe_subscription_id = p_stripe_subscription_id for update;
  if v_prev.id is not null then
    if p_event_created < v_prev.last_event_created then return false; end if; -- out of order
    if v_prev.status = 'canceled' then return false; end if; -- never resurrect
    update public.subscriptions set status = p_status, last_event_created = p_event_created,
      current_period_end = coalesce(p_period_end, current_period_end), updated_at = now() where id = v_prev.id;
  else
    if exists (select 1 from public.sponsorships s where s.athlete_id = p_athlete and s.status = 'active'
               and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())) and p_status in ('active', 'trialing') then
      -- Sponsored athlete: record but flag; the webhook handler must cancel the duplicate subscription.
      insert into public.audit_events (action, target_type, target_ids, purpose) values ('billing.sponsor_conflict', 'athlete', array[p_athlete], 'billing');
    end if;
    insert into public.subscriptions (payer_user_id, athlete_id, stripe_customer_id, stripe_subscription_id, status, last_event_created, current_period_end)
    values (p_payer, p_athlete, p_customer_id, p_stripe_subscription_id, p_status, p_event_created, p_period_end);
  end if;
  return true;
end $$;
revoke execute on function public.billing_upsert_subscription(text, text, uuid, uuid, text, bigint, timestamptz) from public, anon, authenticated;

create or replace function public.my_entitlement(p_athlete_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_uid();
  if not (app.is_athlete_owner(p_athlete_id) or app.is_active_guardian(p_athlete_id)) then perform app.fail('forbidden', 'Not allowed.'); end if;
  if exists (select 1 from public.sponsorships s where s.athlete_id = p_athlete_id and s.status = 'active' and s.starts_at <= now() and (s.ends_at is null or s.ends_at > now())) then
    return jsonb_build_object('active', true, 'funding_source', 'sponsorship');
  elsif exists (select 1 from public.subscriptions s where s.athlete_id = p_athlete_id and s.status in ('active', 'trialing')) then
    return jsonb_build_object('active', true, 'funding_source', 'family_subscription');
  end if;
  return jsonb_build_object('active', false, 'funding_source', 'none');
end $$;

-- ------------------------------------------------------------------ grants for RPCs
-- Functions default to EXECUTE for PUBLIC (and Supabase adds default grants): revoke, then grant explicitly.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_aal2(), app.has_staff_role(text), app.is_staff(text), app.my_athlete_id(),
  app.is_athlete_owner(uuid), app.is_active_guardian(uuid, uuid), app.is_verified_coach(uuid), app.is_verified_relationship_coach(uuid),
  app.is_minor(uuid), app.is_audience_second_adult(uuid, jsonb), app.is_team_staff(uuid), app.is_team_member(uuid),
  app.is_tenant_member(uuid), app.can_see_profile(uuid), app.has_consent(uuid, text), app.require_uid(), app.require_active_athlete(),
  app.fail(text, text)
to authenticated;
grant execute on function
  public.register_profile(text, text, text, boolean, text), public.create_guardian_invite(text), public.cancel_guardian_invite(uuid),
  public.redeem_guardian_invite(text), public.review_guardian_link(uuid, text, text), public.record_consent(text, text, text[], uuid),
  public.withdraw_consent(uuid), public.revoke_guardian_link(uuid), public.create_coach_invite(text, text), public.revoke_coach_invite(uuid),
  public.redeem_coach_invite(text), public.guardian_approve_coach(uuid), public.review_coach_relationship(uuid, text, text),
  public.revoke_coach_relationship(uuid), public.set_second_adult(uuid, uuid), public.verification_queue(),
  public.create_personal_session(text, text, timestamptz, text, timestamptz), public.cancel_session(uuid), public.reschedule_session(uuid, timestamptz, integer),
  public.save_reflection_draft(uuid, uuid, text, text, text, smallint, integer), public.submit_reflection(uuid, uuid, text, text, text, smallint, text),
  public.revise_reflection(uuid, text, text, text, smallint, text),
  public.propose_focus(uuid, text, text, text, text, text, text[], uuid[], text, boolean), public.accept_focus_version(uuid), public.decline_focus_version(uuid),
  public.preview_exchange_audience(uuid), public.create_loop_request(uuid, uuid, text, text, text, text), public.cancel_loop_request(uuid),
  public.coach_save_draft(uuid, text, text, text, text, integer), public.coach_ai_sources(uuid),
  public.coach_store_ai_suggestion(uuid, text, text, text, text, uuid[], text, text, text), public.coach_mark_reviewed(uuid, integer, text),
  public.publish_feedback(uuid, integer, text, text), public.correct_publication(uuid, text, text, text, text, text, text),
  public.decline_loop_request(uuid), public.acknowledge_feedback(uuid, boolean),
  public.coach_create_brief(uuid, uuid, text, text, text, uuid[]), public.coach_advance_brief(uuid, text),
  public.grant_share(text, uuid, uuid, text, text), public.revoke_share(uuid),
  public.update_notification_preferences(boolean, boolean, smallint, smallint), public.mark_notification_read(uuid),
  public.report_concern(text, uuid, text, uuid), public.triage_concern(uuid, text, text, text), public.block_user(uuid),
  public.export_my_data(), public.request_deletion(text), public.register_voice_asset(text, uuid), public.my_entitlement(uuid)
to authenticated;
grant execute on function public.expire_due_requests(), public.process_deletion(uuid), public.billing_record_event(text, text),
  public.billing_upsert_subscription(text, text, uuid, uuid, text, bigint, timestamptz) to service_role;

-- ------------------------------------------------------------------ reference data
insert into public.prompt_templates (key) values ('core-reflection') on conflict (key) do nothing;
insert into public.prompt_versions (template_id, version, locale, question_well, question_moment_back, optional_fields)
select t.id, 1, 'en', 'What did you do well?', 'What moment would you like back?',
  '[{"key":"mood","label":"How did it feel overall? (optional)"},{"key":"support_request","label":"Anything you want support with? (optional)"}]'::jsonb
from public.prompt_templates t where t.key = 'core-reflection'
on conflict do nothing;

insert into public.app_settings (key, value) values
  ('coach_invite_expiry', '"7 days"'), ('guardian_invite_expiry', '"7 days"'), ('response_window', '"48 hours"'),
  ('min_cohort_size', '5')
on conflict (key) do nothing;
