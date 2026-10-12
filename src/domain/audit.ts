import type { AuditEvent } from './types';
import type { UUID } from './ids';
import { newId } from './ids';
import { DomainError } from './errors';

/** Metadata keys that suggest raw content or secrets; audit events must never carry them. */
const FORBIDDEN_KEY = /(text|answer|body|summary|excerpt|question|content|token|secret|password|key|email|phone|transcript|note)/i;

export function buildAuditEvent(input: {
  actorUserId: UUID | null;
  action: string;
  targetType: string;
  targetIds: UUID[];
  purpose: string;
  audienceChange?: string | null;
  correlationId?: string;
  metadata?: AuditEvent['metadata'];
  now: Date;
}): AuditEvent {
  const metadata = input.metadata ?? {};
  for (const [k, v] of Object.entries(metadata)) {
    if (FORBIDDEN_KEY.test(k)) throw new DomainError('validation', `Audit metadata key "${k}" is not allowed.`);
    if (typeof v === 'string' && v.length > 120) throw new DomainError('validation', 'Audit metadata values must be short identifiers.');
  }
  return {
    id: newId(),
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetIds: input.targetIds,
    purpose: input.purpose,
    audienceChange: input.audienceChange ?? null,
    correlationId: input.correlationId ?? newId(),
    metadata,
    createdAt: input.now.toISOString(),
  };
}

/** Redacts likely-sensitive values from operational log lines (distinct from athlete records). */
export function redactForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
      .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
      .replace(/(sk|rk|whsec|sb_secret)_[A-Za-z0-9_]+/g, '[secret]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]');
  }
  if (Array.isArray(value)) return value.map(redactForLog);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, FORBIDDEN_KEY.test(k) ? '[redacted]' : redactForLog(v)]),
    );
  }
  return value;
}
