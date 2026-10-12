import type { CoachInvite } from './types';
import { DEFAULTS } from './constants';
import { normalizeEmail, sha256Hex, timingSafeEqual } from './crypto';

export type InviteFailure = 'not_found' | 'expired' | 'revoked' | 'already_redeemed' | 'email_mismatch';

export function inviteExpiry(now: Date, days: number = DEFAULTS.inviteExpiryDays): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

export async function emailHash(email: string): Promise<string> {
  return sha256Hex(`email:${normalizeEmail(email)}`);
}

export async function tokenHash(token: string): Promise<string> {
  return sha256Hex(`invite:${token}`);
}

/**
 * Validates redemption of a single-use invite. The account email must be *verified* by the auth
 * provider before calling; matching proves account control only, not coach identity — the
 * relationship still enters identity_pending for human review.
 */
export async function checkInviteRedemption(
  invite: CoachInvite | undefined,
  presentedToken: string,
  verifiedAccountEmail: string,
  now: Date,
): Promise<InviteFailure | null> {
  if (!invite) return 'not_found';
  if (!timingSafeEqual(invite.tokenHash, await tokenHash(presentedToken))) return 'not_found';
  if (invite.revokedAt) return 'revoked';
  if (invite.redeemedAt) return 'already_redeemed';
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (!timingSafeEqual(invite.intendedEmailHash, await emailHash(verifiedAccountEmail))) return 'email_mismatch';
  return null;
}

export const INVITE_FAILURE_MESSAGES: Record<InviteFailure, string> = {
  not_found: 'This invitation link is not valid.',
  expired: 'This invitation has expired. Ask the athlete to send a new one.',
  revoked: 'This invitation was withdrawn by the athlete.',
  already_redeemed: 'This invitation has already been used.',
  email_mismatch: 'This invitation was sent to a different email address. Sign in with that account.',
};
