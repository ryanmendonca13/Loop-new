/**
 * Deterministic mock of the server-side AI adapter for demo/tests. It only reorganizes the provided,
 * authorized sources; it never invents quotes or actions. Output is validated by the same contract
 * (validateAiOutput) the real Edge Function uses.
 */
import { firstSentence, type AiSource } from '../../domain';

export const MOCK_MODEL = 'mock-organizer-v1';

export function mockCoachDraft(input: { athleteId: string; sources: AiSource[] }): unknown {
  const excerpt = input.sources.find((s) => s.kind === 'reflection_excerpt');
  const question = input.sources.find((s) => s.kind === 'request_question');
  if (!excerpt || excerpt.text.includes('[simulate-ai-outage]')) throw new Error('ai_unavailable');
  const thin = excerpt.text.trim().split(/\s+/).length < 4;
  return {
    athlete_id: input.athleteId,
    source_record_ids: input.sources.map((s) => s.id),
    summary: thin
      ? ''
      : `The athlete describes this moment: ${firstSentence(excerpt.text, 160)} Their question: ${firstSentence(question?.text ?? '', 120)}`,
    strengths: thin ? [] : ['Named a specific moment to work on'],
    one_next_action: null,
    situation: null,
    measure: null,
    coach_cues: thin ? [] : ['Point to one observable cue in that situation'],
    insufficient_context: thin,
    review_notes: 'Organized from the shared excerpt only. Coach writes the action.',
  };
}
