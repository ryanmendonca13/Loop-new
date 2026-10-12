/**
 * Completion/coverage aggregates (P1, behind flags). Canceled sessions, excused/canceled
 * assignments, unexpected assignments and inactive membership periods never inflate the
 * denominator. Small cohorts are suppressed with complementary suppression to resist differencing.
 */
import type { ActivitySession, Assignment, Membership } from './types';
import type { UUID } from './ids';
import { DEFAULTS } from './constants';

export interface CompletionWindow {
  from: string;
  to: string;
}

function inWindow(t: string, w: CompletionWindow): boolean {
  return t >= w.from && t < w.to;
}

export function membershipActiveAt(memberships: Membership[], athleteId: UUID, teamId: UUID, at: string): boolean {
  return memberships.some(
    (m) =>
      m.athleteId === athleteId &&
      m.teamId === teamId &&
      m.role === 'athlete' &&
      m.status !== 'suspended' &&
      m.startsAt <= at &&
      (m.endsAt === null || at < m.endsAt),
  );
}

export interface CompletionResult {
  teamId: UUID;
  window: CompletionWindow;
  expected: number;
  completed: number;
  athletes: number;
  rate: number | null;
}

export function teamCompletion(
  teamId: UUID,
  sessions: ActivitySession[],
  assignments: Assignment[],
  memberships: Membership[],
  window: CompletionWindow,
): CompletionResult {
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  let expected = 0;
  let completed = 0;
  const athletes = new Set<UUID>();
  for (const a of assignments) {
    const s = sessionById.get(a.sessionId);
    if (!s || s.teamId !== teamId) continue;
    if (s.state === 'canceled') continue;
    if (!inWindow(s.startsAt, window)) continue;
    if (!a.expected || a.state === 'canceled' || a.state === 'excused') continue;
    if (!membershipActiveAt(memberships, a.athleteId, teamId, s.startsAt)) continue;
    expected++;
    athletes.add(a.athleteId);
    if (a.state === 'submitted') completed++;
  }
  return { teamId, window, expected, completed, athletes: athletes.size, rate: expected === 0 ? null : completed / expected };
}

export type SuppressedCell<T> = { key: string; suppressed: true; reason: string } | ({ key: string; suppressed: false } & T);

/**
 * Suppresses cells whose cohort (distinct athletes) is below the minimum. If exactly one cell is
 * suppressed while a total is published, the next-smallest cell is also suppressed so the hidden
 * value cannot be recovered by subtraction.
 */
export function suppressSmallCohorts<T extends { athletes: number }>(
  cells: { key: string; value: T }[],
  minCohort: number = DEFAULTS.minCohortSize,
  totalPublished = true,
): SuppressedCell<T>[] {
  const small = new Set(cells.filter((c) => c.value.athletes < minCohort).map((c) => c.key));
  if (totalPublished && small.size === 1 && cells.length > 1) {
    const nextSmallest = cells
      .filter((c) => !small.has(c.key))
      .sort((a, b) => a.value.athletes - b.value.athletes)[0];
    if (nextSmallest) small.add(nextSmallest.key);
  }
  return cells.map((c) =>
    small.has(c.key)
      ? { key: c.key, suppressed: true as const, reason: `Hidden: fewer than ${minCohort} athletes or protects a hidden group.` }
      : { key: c.key, suppressed: false as const, ...c.value },
  );
}

/** "Check-in needed" is a neutral prompt for a human conversation, never a churn prediction. */
export function teamCheckInNeeded(result: CompletionResult, threshold = 0.4): boolean {
  return result.rate !== null && result.expected >= 5 && result.rate < threshold;
}
