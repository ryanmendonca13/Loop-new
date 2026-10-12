-- Loop Athlete core schema.
-- Conventions: UUID keys, timestamptz (UTC), text + CHECK for states (evolvable), every mutable
-- record has created_at/updated_at/author_id and version where concurrent edits matter.
-- Club/team-owned records carry tenant_id; athlete-owned personal records need no club.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
comment on schema app is 'Private helper functions (not exposed through the Data API).';

-- ---------------------------------------------------------------- utilities
create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function app.bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------- identity
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  locale text not null default 'en' check (char_length(locale) <= 16),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  eligibility_band text not null check (eligibility_band in ('under_13', '13_17', '18_plus')),
  account_state text not null default 'pending_guardian'
    check (account_state in ('pending_guardian', 'active', 'suspended', 'withdrawal_pending', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'No auth email here: profiles are not a directory. No birth date: eligibility band only.';

-- Limited staff roles (support admin, safeguarding owner, verification reviewer). Staff actions require aal2.
create table public.staff_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('support_admin', 'safeguarding_owner', 'verification_reviewer')),
  granted_by uuid references public.profiles (id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index staff_roles_one_active on public.staff_roles (user_id, role) where revoked_at is null;

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  activation_state text not null default 'pending_guardian'
    check (activation_state in ('pending_guardian', 'active', 'suspended', 'withdrawal_pending', 'closed')),
  sport_preference text check (char_length(sport_preference) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger athletes_touch before update on public.athletes for each row execute function app.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- guardians and consent
create table public.guardian_invites (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  intended_email_hash text not null check (char_length(intended_email_hash) = 64),
  intended_email_hint text not null check (char_length(intended_email_hint) <= 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (id),
  revoked_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
create index guardian_invites_athlete on public.guardian_invites (athlete_id);

create table public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  guardian_user_id uuid references public.profiles (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  invite_id uuid references public.guardian_invites (id),
  status text not null default 'invited'
    check (status in ('invited', 'pending_verification', 'active', 'revoked', 'rejected')),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  verification_evidence_ref text check (char_length(verification_evidence_ref) <= 120),
  consent_scope text[] not null default '{}',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint guardian_active_requires_verification check (status <> 'active' or (verified_by is not null and verified_at is not null and guardian_user_id is not null)),
  constraint guardian_not_self check (guardian_user_id is null or guardian_user_id <> verified_by)
);
-- Prevent duplicate live links between the same guardian and athlete.
create unique index guardian_links_one_live on public.guardian_links (guardian_user_id, athlete_id)
  where status in ('invited', 'pending_verification', 'active');
create index guardian_links_athlete on public.guardian_links (athlete_id) where status = 'active';
create trigger guardian_links_version before update on public.guardian_links for each row execute function app.bump_version();

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references public.profiles (id) on delete cascade,
  actor_user_id uuid not null references public.profiles (id),
  purpose text not null check (purpose in ('privacy_notice', 'guardian_consent', 'athlete_assent', 'coach_sharing',
    'ai_processing', 'voice_recording', 'email_notifications', 'sms_notifications')),
  policy_version text not null check (char_length(policy_version) <= 32),
  scope text[] not null default '{}',
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  provenance text not null check (char_length(provenance) <= 120)
);
create index consent_active on public.consent_records (subject_user_id, purpose) where withdrawn_at is null;

-- ---------------------------------------------------------------- tenancy
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default gen_random_uuid() unique,
  name text not null check (char_length(name) <= 120),
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.clubs (tenant_id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  name text not null check (char_length(name) <= 120),
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  team_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  athlete_id uuid references public.athletes (id) on delete cascade,
  role text not null check (role in ('athlete', 'coach', 'director')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'ended', 'suspended')),
  created_at timestamptz not null default now(),
  foreign key (team_id, tenant_id) references public.teams (id, tenant_id) on delete cascade,
  check (ends_at is null or ends_at > starts_at),
  check ((role = 'athlete') = (athlete_id is not null))
);
create index memberships_team on public.memberships (team_id, role, status);
create index memberships_user on public.memberships (user_id);

-- ---------------------------------------------------------------- activity sessions and prompts
create table public.activity_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid references public.athletes (id) on delete cascade,
  team_id uuid,
  tenant_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  sport text check (char_length(sport) <= 40),
  starts_at timestamptz not null,
  timezone text not null default 'UTC',
  state text not null default 'scheduled' check (state in ('scheduled', 'completed', 'canceled', 'archived')),
  reflection_due_at timestamptz,
  next_session_at timestamptz,
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  foreign key (team_id, tenant_id) references public.teams (id, tenant_id) on delete cascade,
  -- Personal session (athlete-owned, no club) XOR team session (tenant-scoped).
  check ((athlete_id is not null and team_id is null and tenant_id is null) or (athlete_id is null and team_id is not null and tenant_id is not null))
);
create index sessions_athlete on public.activity_sessions (athlete_id, starts_at);
create index sessions_team on public.activity_sessions (team_id, starts_at);
create trigger sessions_version before update on public.activity_sessions for each row execute function app.bump_version();

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  created_at timestamptz not null default now()
);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.prompt_templates (id),
  version integer not null,
  locale text not null default 'en',
  question_well text not null,
  question_moment_back text not null,
  optional_fields jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (template_id, version, locale)
);
-- Prompt versions are immutable.
create or replace function app.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable record: % on %', tg_op, tg_table_name using errcode = '42501';
end $$;
create trigger prompt_versions_immutable before update or delete on public.prompt_versions
  for each row execute function app.forbid_mutation();

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  session_id uuid not null references public.activity_sessions (id) on delete cascade,
  prompt_version_id uuid not null references public.prompt_versions (id),
  due_at timestamptz,
  expected boolean not null default true,
  state text not null default 'upcoming' check (state in ('upcoming', 'open', 'draft', 'submitted', 'excused', 'canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, session_id)
);
create trigger assignments_touch before update on public.assignments for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- private diary
create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  assignment_id uuid references public.assignments (id) on delete set null,
  prompt_version_id uuid not null references public.prompt_versions (id),
  answer_well text not null default '' check (char_length(answer_well) <= 1200),
  answer_moment_back text not null default '' check (char_length(answer_moment_back) <= 1200),
  support_request text check (char_length(support_request) <= 500),
  mood smallint check (mood between 1 and 5), -- nullable on purpose: missing mood is never 0
  state text not null default 'draft' check (state in ('draft', 'submitted')),
  submitted_at timestamptz,
  revision_of uuid references public.reflections (id),
  idempotency_key text check (char_length(idempotency_key) between 8 and 100),
  author_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (state <> 'submitted' or (submitted_at is not null and char_length(answer_well) > 0 and char_length(answer_moment_back) > 0))
);
create unique index reflections_idempotency on public.reflections (athlete_id, idempotency_key) where idempotency_key is not null;
create index reflections_athlete on public.reflections (athlete_id, submitted_at desc);
create trigger reflections_version before update on public.reflections for each row execute function app.bump_version();

create table public.voice_assets (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles (id) on delete cascade,
  reflection_id uuid references public.reflections (id) on delete set null,
  storage_path text not null unique,
  consent_record_id uuid not null references public.consent_records (id),
  retention_state text not null default 'active' check (retention_state in ('active', 'delete_pending', 'deleted')),
  transcript_state text not null default 'none' check (transcript_state in ('none', 'draft', 'confirmed', 'error')),
  transcript_draft text check (char_length(transcript_draft) <= 2400),
  transcript_simulated boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger voice_touch before update on public.voice_assets for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------- focus (NOW / NEXT / NORTH STAR)
create table public.focus_plans (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null unique references public.athletes (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.focus_versions (
  id uuid primary key default gen_random_uuid(),
  focus_plan_id uuid not null references public.focus_plans (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  now_text text not null check (char_length(now_text) between 1 and 240),
  next_action text not null check (char_length(next_action) between 1 and 240),
  next_situation text not null check (char_length(next_situation) between 1 and 200),
  next_measure text not null check (char_length(next_measure) between 1 and 200),
  north_star text check (char_length(north_star) <= 240),
  categories text[] not null default '{}' check (categories <@ array['technical', 'tactical', 'physical', 'mental_confidence']),
  source_ids uuid[] not null default '{}',
  author_id uuid not null references public.profiles (id),
  author_role text not null check (author_role in ('athlete', 'coach')),
  change_reason text not null check (char_length(change_reason) between 1 and 200),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id),
  superseded_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  version integer not null default 1,
  check ((accepted_at is null) = (accepted_by is null))
);
-- Exactly one current accepted focus per athlete.
create unique index focus_one_current on public.focus_versions (athlete_id) where accepted_at is not null and superseded_at is null;
create index focus_history on public.focus_versions (athlete_id, created_at desc);

-- ---------------------------------------------------------------- coaches
create table public.coach_invites (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  coach_display_name text not null check (char_length(coach_display_name) between 1 and 60),
  intended_email_hash text not null check (char_length(intended_email_hash) = 64),
  intended_email_hint text not null check (char_length(intended_email_hint) <= 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references public.profiles (id),
  revoked_at timestamptz,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);
create index coach_invites_athlete on public.coach_invites (athlete_id);

create table public.coach_relationships (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  coach_user_id uuid not null references public.profiles (id) on delete cascade,
  invite_id uuid references public.coach_invites (id),
  verification_state text not null default 'invited'
    check (verification_state in ('invited', 'identity_pending', 'verified', 'rejected', 'suspended')),
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  verification_evidence_ref text check (char_length(verification_evidence_ref) <= 120),
  athlete_confirmed_at timestamptz,
  guardian_approved_by uuid references public.profiles (id),
  guardian_approved_at timestamptz,
  second_adult_user_id uuid references public.profiles (id),
  scope text[] not null default array['coach_request'],
  active boolean not null default true,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  check (verification_state <> 'verified' or (verified_by is not null and verified_at is not null and verification_evidence_ref is not null)),
  check (coach_user_id <> coalesce(second_adult_user_id, '00000000-0000-0000-0000-000000000000'::uuid)),
  check (verified_by is null or verified_by <> coach_user_id)
);
create unique index coach_rel_one_live on public.coach_relationships (athlete_id, coach_user_id) where active;
create trigger coach_rel_version before update on public.coach_relationships for each row execute function app.bump_version();

-- ---------------------------------------------------------------- loop requests and feedback
create table public.loop_requests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  reflection_id uuid not null references public.reflections (id),
  session_id uuid references public.activity_sessions (id),
  coach_relationship_id uuid not null references public.coach_relationships (id),
  shared_excerpt text not null check (char_length(shared_excerpt) between 1 and 600),
  question text not null check (char_length(question) between 1 and 300),
  audience jsonb not null,
  audience_hash text not null,
  next_session_at timestamptz,
  due_at timestamptz not null,
  state text not null default 'queued' check (state in ('queued', 'waiting_for_coach', 'response_draft', 'published',
    'athlete_acknowledged', 'closed', 'declined', 'canceled', 'expired')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (athlete_id, idempotency_key)
);
-- At most ONE active coach request per athlete, globally, across all coaches. Enforced by the database.
create unique index loop_requests_one_active on public.loop_requests (athlete_id)
  where state in ('queued', 'waiting_for_coach', 'response_draft');
create index loop_requests_relationship on public.loop_requests (coach_relationship_id, state);
create index loop_requests_due on public.loop_requests (due_at) where state in ('queued', 'waiting_for_coach', 'response_draft');
create trigger loop_requests_version before update on public.loop_requests for each row execute function app.bump_version();

create table public.feedback_drafts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.loop_requests (id) on delete cascade,
  coach_id uuid not null references public.profiles (id),
  summary text not null default '' check (char_length(summary) <= 800),
  one_next_action text not null default '' check (char_length(one_next_action) <= 240),
  situation text not null default '' check (char_length(situation) <= 200),
  measure text not null default '' check (char_length(measure) <= 200),
  ai_source_ids uuid[] not null default '{}',
  ai_model text,
  ai_prompt_version text,
  state text not null default 'manual_draft' check (state in ('manual_draft', 'ai_suggested', 'reviewed', 'published', 'rejected', 'error')),
  reviewed_audience_hash text,
  reviewed_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique (request_id, coach_id)
);
create trigger feedback_drafts_version before update on public.feedback_drafts for each row execute function app.bump_version();

-- Coach-only private notes and team transcripts: never publishable, never visible to athletes or guardians.
create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  athlete_id uuid references public.athletes (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  kind text not null check (kind in ('private_note', 'team_transcript')),
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

create table public.feedback_publications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.loop_requests (id),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  coach_id uuid not null references public.profiles (id),
  draft_id uuid not null references public.feedback_drafts (id),
  summary text not null check (char_length(summary) <= 800),
  one_next_action text not null check (char_length(one_next_action) between 1 and 240),
  situation text not null check (char_length(situation) between 1 and 200),
  measure text not null check (char_length(measure) between 1 and 200),
  approved_by uuid not null references public.profiles (id),
  approved_at timestamptz not null default now(),
  audience jsonb not null,
  audience_hash text not null,
  corrected_from_id uuid references public.feedback_publications (id),
  is_current boolean not null default true,
  version integer not null default 1,
  publish_idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create unique index feedback_one_current on public.feedback_publications (request_id) where is_current;
-- Publications are immutable except the is_current flag flipping false on correction.
create or replace function app.publication_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if current_setting('app.allow_erasure', true) = 'on' then return old; end if;
    raise exception 'feedback publications are immutable' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'is_current') <> (to_jsonb(old) - 'is_current') or (old.is_current = false and new.is_current = true) then
    raise exception 'feedback publications are immutable; publish a correction instead' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger feedback_publications_guard before update or delete on public.feedback_publications
  for each row execute function app.publication_guard();

-- ---------------------------------------------------------------- sharing
create table public.sharing_grants (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('reflection', 'focus_version', 'feedback_publication', 'profile_snapshot')),
  record_id uuid not null,
  owner_athlete_id uuid not null references public.athletes (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  relationship_id uuid,
  surface text not null check (surface in ('coach_request', 'guardian_cues', 'coach_history', 'shared_thread')),
  purpose text not null check (char_length(purpose) <= 120),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index sharing_one_live on public.sharing_grants (record_type, record_id, recipient_user_id, surface) where revoked_at is null;
create index sharing_recipient on public.sharing_grants (recipient_user_id) where revoked_at is null;

create table public.profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  source_record_ids uuid[] not null,
  generator text not null check (generator in ('deterministic', 'ai_suggested')),
  generator_version text not null,
  provenance text not null,
  review_state text not null default 'unreviewed' check (review_state in ('unreviewed', 'athlete_reviewed', 'corrected')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table public.parent_briefs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  guardian_link_id uuid not null references public.guardian_links (id) on delete cascade,
  author_coach_id uuid not null references public.profiles (id),
  something_to_say text not null check (char_length(something_to_say) between 1 and 280),
  question_to_ask text not null check (char_length(question_to_ask) between 1 and 280),
  habit_to_praise text not null check (char_length(habit_to_praise) between 1 and 280),
  source_ids uuid[] not null default '{}',
  state text not null default 'draft' check (state in ('draft', 'coach_reviewed', 'published', 'revoked')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);
create trigger parent_briefs_version before update on public.parent_briefs for each row execute function app.bump_version();

-- ---------------------------------------------------------------- notifications
create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  in_app_enabled boolean not null default true,
  email_reminders boolean not null default false,
  sms_reminders boolean not null default false check (sms_reminders = false), -- SMS is a disabled later feature
  quiet_hours_start smallint not null default 21 check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint not null default 8 check (quiet_hours_end between 0 and 23),
  updated_at timestamptz not null default now()
);

create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'sms')),
  purpose text not null,
  consent_record_id uuid references public.consent_records (id),
  due_at timestamptz not null,
  idempotency_key text not null unique,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  state text not null default 'pending' check (state in ('pending', 'sent', 'failed', 'canceled')),
  title text not null check (char_length(title) <= 120),
  link_path text not null check (link_path like '/%'),
  provider_message_id text,
  last_error text check (char_length(last_error) <= 300),
  read_at timestamptz,
  related_session_id uuid references public.activity_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  check (channel <> 'email' or consent_record_id is not null)
);
create index notification_due on public.notification_jobs (due_at) where state = 'pending';
create index notification_recipient on public.notification_jobs (recipient_user_id, created_at desc);

-- ---------------------------------------------------------------- safeguarding
create table public.concerns (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references public.profiles (id),
  subject_athlete_id uuid references public.athletes (id) on delete set null,
  subject_user_id uuid references public.profiles (id) on delete set null,
  reference_type text check (reference_type in ('loop_request', 'feedback_publication', 'coach_relationship', 'other')),
  reference_id uuid,
  assigned_safeguarding_owner uuid references public.profiles (id),
  severity text not null default 'unassessed' check (severity in ('unassessed', 'low', 'medium', 'high')),
  state text not null default 'open' check (state in ('open', 'triaged', 'escalated', 'closed')),
  description text not null check (char_length(description) between 1 and 2000),
  evidence_ref text check (char_length(evidence_ref) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger concerns_touch before update on public.concerns for each row execute function app.touch_updated_at();

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references public.profiles (id) on delete cascade,
  blocked_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_user_id, blocked_user_id)
);

-- ---------------------------------------------------------------- billing (test mode, off by default)
create table public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  sponsor_name text not null check (char_length(sponsor_name) <= 120),
  tenant_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  payer_user_id uuid not null references public.profiles (id),
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null check (status in ('incomplete', 'trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  last_event_created bigint not null default 0,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
create unique index subscriptions_one_live on public.subscriptions (athlete_id) where status in ('trialing', 'active', 'past_due');

create table public.processed_stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- audit (append-only, minimal)
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null check (char_length(action) <= 80),
  target_type text not null check (char_length(target_type) <= 60),
  target_ids uuid[] not null default '{}',
  purpose text not null check (char_length(purpose) <= 120),
  audience_change text check (char_length(audience_change) <= 200),
  correlation_id uuid not null default gen_random_uuid(),
  metadata jsonb not null default '{}' check (pg_column_size(metadata) < 2048),
  created_at timestamptz not null default now()
);
create index audit_targets on public.audit_events using gin (target_ids);
create index audit_created on public.audit_events (created_at desc);
create trigger audit_append_only before update or delete on public.audit_events
  for each row execute function app.forbid_mutation();

-- ---------------------------------------------------------------- data rights and rate limits
create table public.deletion_requests (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id),
  scope text not null check (scope in ('account', 'voice_only', 'reflections')),
  state text not null default 'requested' check (state in ('requested', 'in_review', 'completed', 'blocked_by_policy')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  bucket text not null,
  actor uuid not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, actor, window_start)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles (id) on delete cascade,
  request_id uuid references public.loop_requests (id) on delete set null,
  model text not null,
  prompt_version text not null,
  outcome text not null check (outcome in ('ok', 'invalid', 'error', 'insufficient_context', 'budget_exceeded')),
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
