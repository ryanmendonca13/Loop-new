/**
 * Notification scheduling: respects consent, preferences, quiet hours (in the recipient's
 * timezone), membership and canceled sessions. Content is neutral: titles and secure in-app links
 * only — never diary text or coach content in email/SMS previews.
 */
import type { NotificationChannel, NotificationJob, NotificationPreferences, NotificationPurpose } from './types';
import type { UUID } from './ids';
import { newId } from './ids';

export const NEUTRAL_TITLES: Record<NotificationPurpose, string> = {
  reflection_reminder: 'Time for a 90-second reflection',
  coach_request_waiting: 'An athlete is waiting for your feedback',
  coach_responded: 'You have new feedback in Loop',
  guardian_invite: 'You have been invited to support an athlete on Loop',
  coach_invite: 'An athlete has invited you to Loop',
  brief_published: 'A new support cue is available',
  consent_update: 'Your Loop settings changed',
  system: 'Update from Loop',
};

/** Returns the hour (0-23) in the given IANA timezone. */
export function localHour(at: Date, timezone: string): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(at);
  return Number(h) % 24;
}

export function inQuietHours(at: Date, prefs: Pick<NotificationPreferences, 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>): boolean {
  const h = localHour(at, prefs.timezone);
  const { quietHoursStart: s, quietHoursEnd: e } = prefs;
  if (s === e) return false;
  return s < e ? h >= s && h < e : h >= s || h < e;
}

/** Defers a due time to the end of quiet hours (checked hourly; bounded to 24 steps). */
export function deferPastQuietHours(at: Date, prefs: Pick<NotificationPreferences, 'quietHoursStart' | 'quietHoursEnd' | 'timezone'>): Date {
  let t = new Date(at);
  for (let i = 0; i < 24 && inQuietHours(t, prefs); i++) {
    t = new Date(t.getTime() + 3600_000);
    t.setUTCMinutes(0, 0, 0);
  }
  return t;
}

export interface ScheduleInput {
  recipientUserId: UUID;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  dueAt: Date;
  idempotencyKey: string;
  linkPath: string;
  prefs: NotificationPreferences;
  channelConsentId: UUID | null;
  relatedSessionId?: UUID | null;
  smsFeatureEnabled?: boolean;
}

export type ScheduleDecision = { schedule: true; job: NotificationJob } | { schedule: false; reason: string };

export function decideNotification(input: ScheduleInput, now: Date): ScheduleDecision {
  if (input.channel === 'sms' && !input.smsFeatureEnabled) return { schedule: false, reason: 'sms_disabled' };
  if (input.channel === 'in_app' && !input.prefs.inAppEnabled) return { schedule: false, reason: 'preference_off' };
  if (input.channel === 'email') {
    if (!input.prefs.emailReminders && input.purpose === 'reflection_reminder') return { schedule: false, reason: 'preference_off' };
    if (!input.channelConsentId) return { schedule: false, reason: 'no_channel_consent' };
  }
  if (!input.linkPath.startsWith('/')) return { schedule: false, reason: 'external_link_forbidden' };
  const due = input.channel === 'in_app' ? input.dueAt : deferPastQuietHours(input.dueAt, input.prefs);
  return {
    schedule: true,
    job: {
      id: newId(),
      recipientUserId: input.recipientUserId,
      channel: input.channel,
      purpose: input.purpose,
      consentRecordId: input.channelConsentId,
      dueAt: due.toISOString(),
      idempotencyKey: input.idempotencyKey,
      attemptCount: 0,
      state: 'pending',
      title: NEUTRAL_TITLES[input.purpose],
      linkPath: input.linkPath,
      providerMessageId: null,
      lastError: null,
      readAt: null,
      relatedSessionId: input.relatedSessionId ?? null,
      createdAt: now.toISOString(),
    },
  };
}

/** Exponential backoff for retries: 1m, 4m, 16m, 64m ... */
export function nextRetryAt(attempt: number, now: Date): Date {
  return new Date(now.getTime() + 60_000 * 4 ** Math.max(0, attempt - 1));
}

/** Human-facing delivery label. "Delivered" requires provider evidence. */
export function deliveryLabel(job: Pick<NotificationJob, 'state' | 'channel' | 'providerMessageId'>): string {
  if (job.channel === 'in_app') return job.state === 'sent' ? 'In your Loop inbox' : 'Pending';
  if (job.state === 'sent' && job.providerMessageId) return 'Accepted by provider (delivery not confirmed)';
  if (job.state === 'sent') return 'Recorded (no provider evidence)';
  if (job.state === 'failed') return 'Failed — will retry';
  if (job.state === 'canceled') return 'Canceled';
  return 'Queued';
}
