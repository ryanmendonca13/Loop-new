/**
 * Product constants. Values marked "proposed pilot default" are listed in DECISIONS.md
 * and must be confirmed by the owner before production.
 */

/** Exact core prompt texts (template version core-v1). Do not paraphrase. */
export const CORE_PROMPT_WELL = 'What did you do well?';
export const CORE_PROMPT_MOMENT_BACK = 'What moment would you like back?';
export const CORE_PROMPT_TEMPLATE_KEY = 'core-reflection';
export const CORE_PROMPT_VERSION = 1;

export const PRODUCT_PROMISE = 'Your reflection. One next step. Feedback from the coach you trust.';

export const LIMITS = {
  answerMax: 1200,
  supportRequestMax: 500,
  excerptMax: 600,
  questionMax: 300,
  feedbackSummaryMax: 800,
  actionMax: 240,
  situationMax: 200,
  measureMax: 200,
  displayNameMax: 60,
  briefFieldMax: 280,
  concernMax: 2000,
  focusFieldMax: 240,
  coachNoteMax: 2000,
} as const;

/** Proposed pilot defaults (see DECISIONS.md). */
export const DEFAULTS = {
  inviteExpiryDays: 7,
  guardianInviteExpiryDays: 7,
  responseWindowHours: 48,
  minCohortSize: 5,
  draftLocalTtlHours: 24,
  quietHoursStart: 21, // 21:00 local
  quietHoursEnd: 8, // 08:00 local
  notificationMaxAttempts: 5,
  signedUrlTtlSeconds: 60,
} as const;

export const FOCUS_CATEGORIES = ['technical', 'tactical', 'physical', 'mental_confidence'] as const;
export const FOCUS_CATEGORY_LABELS: Record<(typeof FOCUS_CATEGORIES)[number], string> = {
  technical: 'Technical',
  tactical: 'Tactical',
  physical: 'Physical',
  mental_confidence: 'Mental / Confidence',
};

/** Mood is optional and neutral; never punitive and never coerced to a number when missing. */
export const MOOD_OPTIONS = [
  { value: 1, label: 'Rough' },
  { value: 2, label: 'Mixed' },
  { value: 3, label: 'Okay' },
  { value: 4, label: 'Good' },
  { value: 5, label: 'Great' },
] as const;
