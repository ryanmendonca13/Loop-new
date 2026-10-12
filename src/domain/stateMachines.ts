import { DomainError } from './errors';

export type Machine<S extends string> = { readonly name: string; readonly transitions: Readonly<Record<S, readonly S[]>> };

function machine<S extends string>(name: string, transitions: Record<S, readonly S[]>): Machine<S> {
  return { name, transitions };
}

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return (m.transitions[from] ?? []).includes(to);
}

export function transition<S extends string>(m: Machine<S>, from: S, to: S): S {
  if (!canTransition(m, from, to)) {
    throw new DomainError('invalid_transition', `${m.name}: cannot move from ${from} to ${to}`);
  }
  return to;
}

export function isTerminal<S extends string>(m: Machine<S>, s: S): boolean {
  return (m.transitions[s] ?? []).length === 0;
}

export type AccountState = 'pending_guardian' | 'active' | 'suspended' | 'withdrawal_pending' | 'closed';
export const accountMachine = machine<AccountState>('account', {
  pending_guardian: ['active', 'closed'],
  active: ['suspended', 'withdrawal_pending'],
  suspended: ['active', 'withdrawal_pending'],
  withdrawal_pending: ['closed', 'active'],
  closed: [],
});

export type CoachVerificationState = 'invited' | 'identity_pending' | 'verified' | 'rejected' | 'suspended';
export const coachVerificationMachine = machine<CoachVerificationState>('coach_verification', {
  invited: ['identity_pending', 'rejected'],
  identity_pending: ['verified', 'rejected'],
  verified: ['suspended'],
  suspended: ['verified', 'rejected'],
  rejected: [],
});

export type ActivitySessionState = 'scheduled' | 'completed' | 'canceled' | 'archived';
export const activitySessionMachine = machine<ActivitySessionState>('activity_session', {
  scheduled: ['completed', 'canceled'],
  completed: ['archived'],
  canceled: ['archived'],
  archived: [],
});

export type AssignmentState = 'upcoming' | 'open' | 'draft' | 'submitted' | 'excused' | 'canceled';
export const assignmentMachine = machine<AssignmentState>('assignment', {
  upcoming: ['open', 'excused', 'canceled'],
  open: ['draft', 'submitted', 'excused', 'canceled'],
  draft: ['submitted', 'excused', 'canceled'],
  submitted: [],
  excused: [],
  canceled: [],
});

export type LoopRequestState =
  | 'queued'
  | 'waiting_for_coach'
  | 'response_draft'
  | 'published'
  | 'athlete_acknowledged'
  | 'closed'
  | 'declined'
  | 'canceled'
  | 'expired';
export const loopRequestMachine = machine<LoopRequestState>('loop_request', {
  queued: ['waiting_for_coach', 'canceled', 'expired'],
  waiting_for_coach: ['response_draft', 'declined', 'canceled', 'expired'],
  response_draft: ['published', 'waiting_for_coach', 'declined', 'canceled', 'expired'],
  published: ['athlete_acknowledged', 'closed'],
  athlete_acknowledged: ['closed'],
  closed: [],
  declined: [],
  canceled: [],
  expired: [],
});
/** States that occupy the single active-request slot (mirrors the DB partial unique index). */
export const ACTIVE_REQUEST_STATES: readonly LoopRequestState[] = ['queued', 'waiting_for_coach', 'response_draft'];

export type FeedbackDraftState = 'manual_draft' | 'ai_suggested' | 'reviewed' | 'published' | 'rejected' | 'error';
export const feedbackDraftMachine = machine<FeedbackDraftState>('feedback_draft', {
  manual_draft: ['reviewed', 'rejected'],
  ai_suggested: ['manual_draft', 'reviewed', 'rejected'],
  reviewed: ['published', 'manual_draft'],
  error: ['manual_draft'],
  published: [],
  rejected: ['manual_draft'],
});

export type ParentBriefState = 'draft' | 'coach_reviewed' | 'published' | 'revoked';
export const parentBriefMachine = machine<ParentBriefState>('parent_brief', {
  draft: ['coach_reviewed'],
  coach_reviewed: ['published', 'draft'],
  published: ['revoked'],
  revoked: [],
});

export type GuardianLinkState = 'invited' | 'pending_verification' | 'active' | 'revoked' | 'rejected';
export const guardianLinkMachine = machine<GuardianLinkState>('guardian_link', {
  invited: ['pending_verification', 'revoked'],
  pending_verification: ['active', 'rejected', 'revoked'],
  active: ['revoked'],
  revoked: [],
  rejected: [],
});

export type NotificationJobState = 'pending' | 'sent' | 'failed' | 'canceled';
export const notificationMachine = machine<NotificationJobState>('notification_job', {
  pending: ['sent', 'failed', 'canceled', 'pending'],
  failed: ['pending', 'canceled'],
  sent: [],
  canceled: [],
});

export type ConcernState = 'open' | 'triaged' | 'escalated' | 'closed';
export const concernMachine = machine<ConcernState>('concern', {
  open: ['triaged', 'escalated', 'closed'],
  triaged: ['escalated', 'closed'],
  escalated: ['closed'],
  closed: [],
});
