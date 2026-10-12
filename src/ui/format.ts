export function formatWhen(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(d);
}

export function relativeDue(iso: string, now = new Date()): string {
  const ms = new Date(iso).getTime() - now.getTime();
  const h = Math.round(ms / 3600_000);
  if (ms <= 0) return 'past due';
  if (h < 1) return 'within the hour';
  if (h < 48) return `in about ${h} hour${h === 1 ? '' : 's'}`;
  return `in ${Math.round(h / 24)} days`;
}

export const GAP_TEXT: Record<string, string> = {
  privacy_notice: 'Read and accept the privacy notice',
  verified_guardian_link: 'A guardian accepts the invite and the link is verified by the pilot team',
  guardian_consent: 'Your guardian records consent',
  athlete_assent: 'You agree to use Loop (your assent)',
  under_13_review: 'Under-13 use needs guardian-led review before it can start',
};
