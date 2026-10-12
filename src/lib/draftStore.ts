/**
 * Offline-safe local draft recovery. Drafts are kept briefly (TTL) in localStorage so a dropped
 * connection or reload doesn't lose 90 seconds of writing — but never indefinitely, and they are
 * cleared on submit, sign-out, or expiry. Storage failures (private mode) are tolerated.
 */
import { DEFAULTS } from '../domain';

export interface LocalDraft {
  userId: string;
  assignmentId: string | null;
  reflectionId: string | null;
  answerWell: string;
  answerMomentBack: string;
  supportRequest: string;
  mood: number | null;
  savedAt: number;
}

const PREFIX = 'loop.draft.v1:';
const keyFor = (userId: string, assignmentId: string | null) => `${PREFIX}${userId}:${assignmentId ?? 'adhoc'}`;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveLocalDraft(d: Omit<LocalDraft, 'savedAt'>, now = Date.now()): void {
  try {
    storage()?.setItem(keyFor(d.userId, d.assignmentId), JSON.stringify({ ...d, savedAt: now }));
  } catch {
    /* quota or privacy mode: server autosave still applies */
  }
}

export function loadLocalDraft(userId: string, assignmentId: string | null, now = Date.now()): LocalDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(keyFor(userId, assignmentId));
    if (!raw) return null;
    const d = JSON.parse(raw) as LocalDraft;
    if (d.userId !== userId || now - d.savedAt > DEFAULTS.draftLocalTtlHours * 3600_000) {
      s.removeItem(keyFor(userId, assignmentId));
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function clearLocalDraft(userId: string, assignmentId: string | null): void {
  try {
    storage()?.removeItem(keyFor(userId, assignmentId));
  } catch {
    /* ignore */
  }
}

/** Removes every local draft (sign-out, persona switch, account deletion). */
export function purgeLocalDrafts(): void {
  const s = storage();
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith(PREFIX)) s.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '')}`;
}
