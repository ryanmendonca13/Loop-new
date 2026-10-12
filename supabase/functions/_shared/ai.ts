/**
 * Server-side LLM adapter (Claude API by default, mock until configured). Browser code never calls an LLM.
 * Inputs: only the authorized, minimal sources for ONE request (from the coach_ai_sources RPC, executed with
 * the coach's own JWT so RLS/RPC checks apply). Output is validated before it is stored as a PRIVATE draft.
 */
import { AI_PROMPT_VERSION, buildCoachDraftPrompt, validateAiOutput, type AiSource } from '../../../src/domain/ai';
import type { ServerEnv } from './env';

export interface AiProvider {
  name: string;
  model: string;
  complete(prompt: { system: string; user: string }, signal: AbortSignal): Promise<string>;
}

export function mockProvider(): AiProvider {
  return {
    name: 'mock',
    model: 'mock-organizer-v1',
    async complete(p) {
      const ids = [...p.user.matchAll(/<source id="([^"]+)" kind="([^"]+)"><athlete_text>([\s\S]*?)<\/athlete_text>/g)];
      const athlete = p.system.match(/athlete_id="([^"]+)"/)?.[1];
      const excerpt = ids.find((m) => m[2] === 'reflection_excerpt')?.[3] ?? '';
      return JSON.stringify({
        athlete_id: athlete,
        source_record_ids: ids.map((m) => m[1]),
        summary: excerpt.split(/\s+/).length < 4 ? '' : `The athlete describes this moment: ${excerpt.slice(0, 160)}`,
        strengths: [],
        one_next_action: null,
        situation: null,
        measure: null,
        insufficient_context: excerpt.split(/\s+/).length < 4,
        review_notes: 'Mock output.',
      });
    },
  };
}

export function anthropicProvider(env: ServerEnv, fetchImpl: typeof fetch = fetch): AiProvider {
  if (!env.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return {
    name: 'anthropic',
    model: env.aiModel,
    async complete(p, signal) {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: { 'x-api-key': env.anthropicApiKey!, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.aiModel, max_tokens: env.aiMaxOutputTokens, system: p.system, messages: [{ role: 'user', content: p.user }] }),
      });
      if (!res.ok) throw new Error(`ai_http_${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      return body.content?.find((c) => c.type === 'text')?.text ?? '';
    },
  };
}

export type DraftOutcome =
  | { ok: true; summary: string; sourceIds: string[]; warnings: string[]; model: string; promptVersion: string }
  | { ok: false; outcome: 'invalid' | 'error' | 'insufficient_context'; reason: string; model: string; promptVersion: string };

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function runCoachDraft(input: { athleteId: string; sources: AiSource[]; focusNow: string | null }, provider: AiProvider, env: Pick<ServerEnv, 'aiTimeoutMs' | 'aiActionRecommendations'>): Promise<DraftOutcome> {
  const base = { model: provider.model, promptVersion: AI_PROMPT_VERSION };
  const prompt = buildCoachDraftPrompt(input);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), env.aiTimeoutMs);
  let text: string;
  try {
    text = await provider.complete(prompt, ctrl.signal);
  } catch {
    return { ok: false, outcome: 'error', reason: 'AI is unavailable right now. Write your response manually — nothing was lost.', ...base };
  } finally {
    clearTimeout(timer);
  }
  const v = validateAiOutput(extractJson(text), { athleteId: input.athleteId, sources: input.sources, actionRecommendationsEnabled: env.aiActionRecommendations });
  if (!v.ok) return { ok: false, outcome: 'invalid', reason: `The suggestion was discarded (${v.reason}). Write your response manually.`, ...base };
  if (v.value.insufficient_context) return { ok: false, outcome: 'insufficient_context', reason: 'Not enough shared context for a useful suggestion. Write your response manually.', ...base };
  return { ok: true, summary: v.value.summary, sourceIds: v.value.source_record_ids, warnings: v.warnings, ...base };
}
