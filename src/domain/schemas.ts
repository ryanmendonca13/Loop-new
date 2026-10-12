import { z } from 'zod';
import { LIMITS, FOCUS_CATEGORIES } from './constants';

/** Trims, normalizes whitespace and strips control characters (except newlines). */
const cleanText = (max: number) =>
  z
    .string()
    // eslint-disable-next-line no-control-regex -- deliberately strips control characters
    .transform((s) => s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim())
    .pipe(z.string().max(max, `Keep this under ${max} characters.`));

const requiredText = (max: number, label: string) =>
  cleanText(max).pipe(z.string().min(1, `${label} is required.`));

export const idempotencyKeySchema = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/);

export const reflectionDraftSchema = z.object({
  answerWell: cleanText(LIMITS.answerMax),
  answerMomentBack: cleanText(LIMITS.answerMax),
  supportRequest: cleanText(LIMITS.supportRequestMax).nullable(),
  /** Optional. Missing mood stays null: never coerced to 0. */
  mood: z.number().int().min(1).max(5).nullable(),
});
export type ReflectionDraftInput = z.input<typeof reflectionDraftSchema>;

export const reflectionSubmitSchema = reflectionDraftSchema.extend({
  answerWell: requiredText(LIMITS.answerMax, 'What you did well'),
  answerMomentBack: requiredText(LIMITS.answerMax, 'The moment you would like back'),
  idempotencyKey: idempotencyKeySchema,
});
export type ReflectionSubmitInput = z.input<typeof reflectionSubmitSchema>;

export const nextActionSchema = z.object({
  action: requiredText(LIMITS.actionMax, 'Action'),
  situation: requiredText(LIMITS.situationMax, 'Situation'),
  measure: requiredText(LIMITS.measureMax, 'Measure'),
});

export const focusProposalSchema = z.object({
  now: requiredText(LIMITS.focusFieldMax, 'NOW'),
  nextAction: requiredText(LIMITS.actionMax, 'NEXT action'),
  nextSituation: requiredText(LIMITS.situationMax, 'NEXT situation'),
  nextMeasure: requiredText(LIMITS.measureMax, 'NEXT measure'),
  northStar: cleanText(LIMITS.focusFieldMax).nullable(),
  categories: z.array(z.enum(FOCUS_CATEGORIES)).max(4).default([]),
  sourceIds: z.array(z.uuid()).max(20),
  changeReason: requiredText(200, 'Reason for change'),
});
export type FocusProposalInput = z.input<typeof focusProposalSchema>;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254));

export const coachInviteSchema = z.object({
  coachDisplayName: requiredText(LIMITS.displayNameMax, 'Coach name'),
  coachEmail: emailSchema,
});

export const guardianInviteSchema = z.object({
  guardianEmail: emailSchema,
});

export const loopRequestSchema = z.object({
  reflectionId: z.uuid(),
  coachRelationshipId: z.uuid(),
  sharedExcerpt: requiredText(LIMITS.excerptMax, 'Shared excerpt'),
  question: requiredText(LIMITS.questionMax, 'Question'),
  /** The audience hash the athlete saw before submitting; must match the server's current audience. */
  confirmedAudienceHash: z.string().min(8),
  idempotencyKey: idempotencyKeySchema,
});
export type LoopRequestInput = z.input<typeof loopRequestSchema>;

export const feedbackDraftSchema = z.object({
  summary: cleanText(LIMITS.feedbackSummaryMax),
  oneNextAction: cleanText(LIMITS.actionMax),
  situation: cleanText(LIMITS.situationMax),
  measure: cleanText(LIMITS.measureMax),
});
export type FeedbackDraftInput = z.input<typeof feedbackDraftSchema>;

export const feedbackPublishSchema = z.object({
  draftId: z.uuid(),
  draftVersion: z.number().int().positive(),
  confirmedAudienceHash: z.string().min(8),
  idempotencyKey: idempotencyKeySchema,
});

export const parentBriefSchema = z.object({
  somethingToSay: requiredText(LIMITS.briefFieldMax, 'Something to say'),
  questionToAsk: requiredText(LIMITS.briefFieldMax, 'Question to ask'),
  habitToPraise: requiredText(LIMITS.briefFieldMax, 'Habit to praise'),
});

export const concernSchema = z.object({
  description: requiredText(LIMITS.concernMax, 'Description'),
  subjectAthleteId: z.uuid().nullable(),
  referenceType: z.enum(['loop_request', 'feedback_publication', 'coach_relationship', 'other']).nullable(),
  referenceId: z.uuid().nullable(),
});

export const athleteSignupSchema = z.object({
  displayName: requiredText(LIMITS.displayNameMax, 'Display name'),
  eligibilityBand: z.enum(['under_13', '13_17', '18_plus']),
  timezone: z.string().min(1).max(64),
  guardianEmail: emailSchema.optional(),
});

export const notificationPrefsSchema = z.object({
  inAppEnabled: z.boolean(),
  emailReminders: z.boolean(),
  quietHoursStart: z.number().int().min(0).max(23),
  quietHoursEnd: z.number().int().min(0).max(23),
});

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}
