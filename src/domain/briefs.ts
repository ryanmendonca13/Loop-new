/**
 * Parent support briefs: short, reviewed cues for a verified linked guardian. Raw diary answers and
 * quotes are excluded by default — a brief that reproduces a long run of the athlete's words is refused.
 */
import type { Reflection } from './types';

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** True when the brief shares any run of `n` consecutive words with the athlete's private answers. */
export function briefLeaksDiary(brief: { somethingToSay: string; questionToAsk: string; habitToPraise: string }, reflections: Pick<Reflection, 'answerWell' | 'answerMomentBack' | 'supportRequest'>[], n = 6): boolean {
  const grams = new Set<string>();
  for (const r of reflections) {
    for (const t of [r.answerWell, r.answerMomentBack, r.supportRequest ?? '']) {
      const w = words(t);
      for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(' '));
    }
  }
  for (const t of [brief.somethingToSay, brief.questionToAsk, brief.habitToPraise]) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) if (grams.has(w.slice(i, i + n).join(' '))) return true;
  }
  return /["“]/.test(`${brief.somethingToSay}${brief.questionToAsk}${brief.habitToPraise}`);
}

const PRESSURE_PATTERNS = /\b(rank(ed|ing)?|score|rating|worst|best on the team|behind (the )?others|must|failure|lazy)\b/i;

export function briefHasPressureLanguage(brief: { somethingToSay: string; questionToAsk: string; habitToPraise: string }): boolean {
  return PRESSURE_PATTERNS.test(`${brief.somethingToSay} ${brief.questionToAsk} ${brief.habitToPraise}`);
}
