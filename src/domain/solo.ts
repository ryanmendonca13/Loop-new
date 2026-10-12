/**
 * Solo ABZ organizer: deterministic, no AI, no invented content.
 *   A = NOW   (where I am, in the athlete's own words)
 *   B = NEXT  (one action, in one situation, with a simple measure; chosen/edited by the athlete)
 *   Z = NORTH STAR (longer-term direction; only ever athlete-approved)
 * Solo output is labeled "Personal reflection" and never presented as coach feedback.
 */
import type { FocusCategory, FocusVersion, Reflection } from './types';
import type { UUID } from './ids';

export interface SoloOrganized {
  sourceId: UUID;
  now: { text: string; label: 'Your words' };
  strength: { text: string; label: 'Your words' };
  supportRequest: string | null;
  suggestedCategories: { category: FocusCategory; label: 'Suggested tag (optional)' }[];
  nextScaffold: { action: string; situation: string; measure: string; label: 'Template — edit in your own words' };
  currentNorthStar: string | null;
  disclaimer: string;
}

export function firstSentence(text: string, max = 200): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^[\s\S]*?[.!?](\s|$)/);
  const s = (m ? m[0] : trimmed).trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const CATEGORY_KEYWORDS: Record<FocusCategory, string[]> = {
  technical: ['touch', 'pass', 'shot', 'shoot', 'serve', 'swing', 'stroke', 'technique', 'grip', 'footwork', 'catch', 'dribble'],
  tactical: ['position', 'space', 'press', 'decision', 'read', 'shape', 'transition', 'mark', 'defend', 'play', 'option'],
  physical: ['tired', 'sprint', 'fitness', 'legs', 'speed', 'strength', 'recover', 'stamina', 'jump'],
  mental_confidence: ['nervous', 'confidence', 'confident', 'focus', 'pressure', 'calm', 'mistake', 'frustrat', 'doubt', 'hesitat'],
};

export function suggestCategories(text: string): FocusCategory[] {
  const lower = text.toLowerCase();
  return (Object.keys(CATEGORY_KEYWORDS) as FocusCategory[]).filter((c) => CATEGORY_KEYWORDS[c].some((k) => lower.includes(k)));
}

export function organizeSolo(reflection: Reflection, currentFocus: FocusVersion | null): SoloOrganized {
  return {
    sourceId: reflection.id,
    now: { text: firstSentence(reflection.answerMomentBack), label: 'Your words' },
    strength: { text: firstSentence(reflection.answerWell), label: 'Your words' },
    supportRequest: reflection.supportRequest,
    suggestedCategories: suggestCategories(`${reflection.answerWell} ${reflection.answerMomentBack}`).map((category) => ({
      category,
      label: 'Suggested tag (optional)',
    })),
    nextScaffold: {
      action: '',
      situation: '',
      measure: '',
      label: 'Template — edit in your own words',
    },
    currentNorthStar: currentFocus?.northStar ?? null,
    disclaimer: 'Organized from your own words. This is your notebook, not coach feedback.',
  };
}

/** Deterministic profile snapshot: athlete words only, no ratings or personality labels. */
export function deterministicProfile(reflections: Reflection[], limit = 5): { strengths: string[]; recurringMoments: string[] } {
  const submitted = reflections
    .filter((r) => r.state === 'submitted')
    .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
    .slice(0, limit);
  const strengths = submitted.map((r) => firstSentence(r.answerWell, 140));
  const counts = new Map<FocusCategory, number>();
  for (const r of submitted) for (const c of suggestCategories(r.answerMomentBack)) counts.set(c, (counts.get(c) ?? 0) + 1);
  const recurringMoments = [...counts.entries()].filter(([, n]) => n >= 2).map(([c]) => c);
  return { strengths, recurringMoments };
}
