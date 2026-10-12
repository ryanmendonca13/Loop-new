-- Synthetic seed for LOCAL development only (fictional people, *.example.test addresses).
-- Never run against staging/production. Uses the real RPCs (as each fictional user) so seed data obeys
-- the same rules as the app. Staff aal2 is simulated via JWT claims here only.
do $$
declare
  v_reviewer uuid := 'd0000000-0000-4000-8000-000000000001';
  v_max uuid := 'a0000000-0000-4000-8000-000000000001';
  v_ava uuid := 'a0000000-0000-4000-8000-000000000002';
  v_pat uuid := 'b0000000-0000-4000-8000-000000000001';
  v_sam uuid := 'c0000000-0000-4000-8000-000000000001';
  r jsonb; v_link uuid; v_rel uuid; v_max_athlete uuid;
begin
  if exists (select 1 from auth.users where id = v_max) then return; end if;
  insert into auth.users (id, email, email_confirmed_at) values
    (v_reviewer, 'jordan@pilot.example.test', now()), (v_max, 'max@athlete.example.test', now()),
    (v_ava, 'ava.t@athlete.example.test', now()), (v_pat, 'pat@family.example.test', now()), (v_sam, 'sam@coach.example.test', now());

  perform set_config('request.jwt.claims', json_build_object('sub', v_reviewer, 'role', 'authenticated')::text, true);
  perform public.register_profile('Jordan B.', '18_plus', 'America/Toronto', false, 'pilot-2026-10');
  insert into public.staff_roles (user_id, role) values (v_reviewer, 'verification_reviewer'), (v_reviewer, 'safeguarding_owner');
  insert into public.app_settings (key, value) values ('safeguarding_owner_user_id', to_jsonb(v_reviewer::text)) on conflict (key) do nothing;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform public.register_profile('Pat O.', '18_plus', 'America/Toronto', false, 'pilot-2026-10');
  perform set_config('request.jwt.claims', json_build_object('sub', v_sam, 'role', 'authenticated')::text, true);
  perform public.register_profile('Coach Sam R.', '18_plus', 'America/Toronto', false, 'pilot-2026-10');
  perform set_config('request.jwt.claims', json_build_object('sub', v_ava, 'role', 'authenticated')::text, true);
  perform public.register_profile('Ava T.', '18_plus', 'America/Vancouver', true, 'pilot-2026-10');

  -- Minor: pending shell -> guardian invite -> redeem -> human verification -> consent + assent.
  perform set_config('request.jwt.claims', json_build_object('sub', v_max, 'role', 'authenticated')::text, true);
  r := public.register_profile('Max O.', '13_17', 'America/Toronto', true, 'pilot-2026-10');
  v_max_athlete := (r ->> 'athlete_id')::uuid;
  r := public.create_guardian_invite('pat@family.example.test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  v_link := (public.redeem_guardian_invite(r ->> 'token') ->> 'link_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_reviewer, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.review_guardian_link(v_link, 'verify', 'seed-call-0001');
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform public.record_consent('guardian_consent', 'pilot-2026-10', array['coach_exchange'], v_max_athlete);
  perform set_config('request.jwt.claims', json_build_object('sub', v_max, 'role', 'authenticated')::text, true);
  perform public.record_consent('athlete_assent', 'pilot-2026-10');
  perform public.record_consent('coach_sharing', 'pilot-2026-10');
  r := public.create_coach_invite('Coach Sam R.', 'sam@coach.example.test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_sam, 'role', 'authenticated')::text, true);
  v_rel := (public.redeem_coach_invite(r ->> 'token') ->> 'relationship_id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform public.guardian_approve_coach(v_rel);
  perform set_config('request.jwt.claims', json_build_object('sub', v_reviewer, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform public.review_coach_relationship(v_rel, 'verify', 'seed-id-0007');
  perform set_config('request.jwt.claims', json_build_object('sub', v_max, 'role', 'authenticated')::text, true);
  perform public.create_personal_session('Thursday practice', 'Soccer', now() - interval '1 day', 'America/Toronto', now() + interval '2 days');
  perform set_config('request.jwt.claims', '', true);
end $$;
