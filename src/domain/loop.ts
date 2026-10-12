import type { LoopRequest } from './types';
import { DEFAULTS } from './constants';

export type LoopLabel =
  | 'Personal reflection'
  | 'Awaiting coach'
  | 'Coach drafting'
  | 'Coach responded'
  | 'Loop closed'
  | 'Request expired'
  | 'Request declined'
  | 'Request canceled';

/**
 * Honest status vocabulary. Only a published human coach response earns "Coach responded";
 * only acknowledgment/closure after that earns "Loop closed". Solo stays "Personal reflection".
 */
export function loopLabel(request: Pick<LoopRequest, 'state'> | null | undefined): LoopLabel {
  if (!request) return 'Personal reflection';
  switch (request.state) {
    case 'queued':
    case 'waiting_for_coach':
      return 'Awaiting coach';
    case 'response_draft':
      return 'Coach drafting';
    case 'published':
      return 'Coach responded';
    case 'athlete_acknowledged':
    case 'closed':
      return 'Loop closed';
    case 'expired':
      return 'Request expired';
    case 'declined':
      return 'Request declined';
    case 'canceled':
      return 'Request canceled';
  }
}

/** Response window: next session deadline when in the future, else the default window (48h demo). */
export function responseDueAt(nextSessionAt: string | null, now: Date, windowHours: number = DEFAULTS.responseWindowHours): string {
  if (nextSessionAt) {
    const t = new Date(nextSessionAt);
    if (t.getTime() > now.getTime()) return t.toISOString();
  }
  return new Date(now.getTime() + windowHours * 3600_000).toISOString();
}

export function isPastDue(dueAt: string, now: Date): boolean {
  return new Date(dueAt).getTime() <= now.getTime();
}

/** Overdue is a timing flag only, never a judgment of the athlete. */
export function assignmentTimingFlag(dueAt: string | null, submitted: boolean, now: Date): 'on_time' | 'overdue' | 'no_deadline' {
  if (!dueAt) return 'no_deadline';
  if (submitted) return 'on_time';
  return isPastDue(dueAt, now) ? 'overdue' : 'on_time';
}
