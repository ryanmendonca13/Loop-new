/**
 * Notification dispatch with retries and dedupe. A job is marked "sent" only with provider evidence
 * (a provider message id); "delivered" is never claimed. Content is neutral: title + secure in-app link.
 */
import { nextRetryAt, inQuietHours } from '../../../src/domain/notifications';
import { DEFAULTS } from '../../../src/domain/constants';

export interface PendingJob {
  id: string;
  channel: 'in_app' | 'email' | 'sms';
  recipientEmail: string | null;
  title: string;
  linkPath: string;
  attemptCount: number;
  prefs: { quietHoursStart: number; quietHoursEnd: number; timezone: string; emailReminders: boolean };
  consentActive: boolean;
}

export interface EmailProvider {
  send(msg: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>;
}

export const mockEmailProvider = (): EmailProvider & { sent: unknown[] } => {
  const sent: unknown[] = [];
  return { sent, async send(m) { sent.push(m); return { messageId: `mock_${m.idempotencyKey}` }; } };
};

export type JobUpdate =
  | { id: string; state: 'sent'; providerMessageId: string; attemptCount: number }
  | { id: string; state: 'pending'; dueAt: string; attemptCount: number; lastError: string }
  | { id: string; state: 'failed'; attemptCount: number; lastError: string }
  | { id: string; state: 'canceled'; lastError: string }
  | { id: string; state: 'deferred'; dueAt: string };

export async function dispatchJob(job: PendingJob, provider: EmailProvider, baseUrl: string, now: Date): Promise<JobUpdate> {
  if (job.channel === 'sms') return { id: job.id, state: 'canceled', lastError: 'sms_disabled' };
  if (job.channel !== 'email') return { id: job.id, state: 'canceled', lastError: 'not_email' };
  if (!job.consentActive || !job.recipientEmail) return { id: job.id, state: 'canceled', lastError: 'no_consent_or_address' };
  if (inQuietHours(now, job.prefs)) return { id: job.id, state: 'deferred', dueAt: new Date(now.getTime() + 3600_000).toISOString() };
  const attempt = job.attemptCount + 1;
  try {
    const r = await provider.send({
      to: job.recipientEmail,
      subject: job.title,
      text: `${job.title}\n\nOpen Loop: ${baseUrl}${job.linkPath}\n\nYou can change notification settings in Loop.`,
      idempotencyKey: job.id,
    });
    return { id: job.id, state: 'sent', providerMessageId: r.messageId, attemptCount: attempt };
  } catch (e) {
    const err = (e as Error).message.slice(0, 200);
    if (attempt >= DEFAULTS.notificationMaxAttempts) return { id: job.id, state: 'failed', attemptCount: attempt, lastError: err };
    return { id: job.id, state: 'pending', dueAt: nextRetryAt(attempt, now).toISOString(), attemptCount: attempt, lastError: err };
  }
}
