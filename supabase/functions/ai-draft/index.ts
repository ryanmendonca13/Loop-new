// Edge Function: ai-draft. Runs as the calling coach (their JWT), so the coach_ai_sources and
// coach_store_ai_suggestion RPCs re-check that they are a verified coach for THIS request.
// No service-role key is used. AI output becomes a private draft only; it can never publish.
import { createClient } from '@supabase/supabase-js';
import { readEnv, json, CORS_HEADERS } from '../_shared/env.ts';
import { anthropicProvider, mockProvider, runCoachDraft } from '../_shared/ai.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve(h: (r: Request) => Promise<Response>): void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  const env = readEnv((k) => Deno.env.get(k));
  const auth = req.headers.get('authorization');
  if (!auth) return json({ ok: false, reason: 'unauthorized' }, 401);
  const body = (await req.json().catch(() => null)) as { request_id?: string } | null;
  if (!body?.request_id || !/^[0-9a-f-]{36}$/i.test(body.request_id)) return json({ ok: false, reason: 'invalid_request' }, 400);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { authorization: auth } } });
  const { data: src, error } = await sb.rpc('coach_ai_sources', { p_request_id: body.request_id });
  if (error) return json({ ok: false, reason: 'not_found' }, 404);
  // Per-coach budget: ai_usage rows are written by coach_store_ai_suggestion; provider-side spend limits must also be set.

  const provider = env.aiProvider === 'anthropic' ? anthropicProvider(env) : mockProvider();
  const out = await runCoachDraft({ athleteId: src.athlete_id, sources: src.sources, focusNow: src.focus_now }, provider, env);
  const stored = await sb.rpc('coach_store_ai_suggestion', {
    p_request_id: body.request_id,
    p_summary: out.ok ? out.summary : null,
    p_one_next_action: null,
    p_situation: null,
    p_measure: null,
    p_source_ids: out.ok ? out.sourceIds : [],
    p_model: out.model,
    p_prompt_version: out.promptVersion,
    p_outcome: out.ok ? 'ok' : out.outcome,
  });
  if (stored.error) return json({ ok: false, reason: 'Could not store the draft. Write your response manually.' }, 409);
  if (!out.ok) return json({ ok: false, reason: out.reason });
  return json({ ok: true, warnings: out.warnings, draft_id: (stored.data as { draft_id: string }).draft_id });
});
