export type DomainErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'invalid_transition'
  | 'conflict'
  | 'active_request_exists'
  | 'second_adult_required'
  | 'coach_not_verified'
  | 'account_not_active'
  | 'invite_invalid'
  | 'stale_review'
  | 'consent_required'
  | 'rate_limited'
  | 'feature_disabled'
  | 'ai_unavailable';

/** Domain errors carry a stable code and a user-safe message (never sensitive content). */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function assert(condition: unknown, code: DomainErrorCode, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError || (typeof e === 'object' && e !== null && (e as { name?: string }).name === 'DomainError');
}
