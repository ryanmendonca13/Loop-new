import { describe, expect, it } from 'vitest';
import { runCoachDraft, mockProvider, anthropicProvider, type AiProvider } from './ai';
import { signStripePayload, toDomainEvent, verifyStripeSignature } from './stripe';
import { dispatchJob, mockEmailProvider } from './notify';
import { readEnv } from './env';

const athleteId = '00000000-0000-4000-8000-000000000010';
const sources = [
  { id: '00000000-0000-4000-8000-000000000001', kind: 'request_question' as const, text: 'How do I shoot sooner?' },
  { id: '00000000-0000-4000-8000-000000000002', kind: 'reflection_excerpt' as const, text: 'I hesitated before the shot in the second half.' },
];
const env = { aiTimeoutMs: 200, aiActionRecommendations: false };

describe('AI adapter', () => {
  it('mock provider produces a validated draft from authorized sources only', async () => {
    const r = await runCoachDraft({ athleteId, sources, focusNow: null }, mockProvider(), env);
    expect(r.ok).toBe(true);
  });
  it('malicious/invalid model output is discarded; outage and timeout fall back to manual', async () => {
    const evil: AiProvider = { name: 'x', model: 'x', complete: async () => JSON.stringify({ athlete_id: '00000000-0000-4000-8000-000000000099', source_record_ids: [sources[0]!.id], summary: 'x', strengths: [], one_next_action: null, situation: null, measure: null, insufficient_context: false, review_notes: '' }) };
    expect(await runCoachDraft({ athleteId, sources, focusNow: null }, evil, env)).toMatchObject({ ok: false, outcome: 'invalid' });
    const quote: AiProvider = { ...evil, complete: async () => JSON.stringify({ athlete_id: athleteId, source_record_ids: [sources[1]!.id], summary: 'They said "I want to quit".', strengths: [], one_next_action: null, situation: null, measure: null, insufficient_context: false, review_notes: '' }) };
    expect(await runCoachDraft({ athleteId, sources, focusNow: null }, quote, env)).toMatchObject({ ok: false, outcome: 'invalid' });
    const down: AiProvider = { ...evil, complete: async () => { throw new Error('503'); } };
    expect(await runCoachDraft({ athleteId, sources, focusNow: null }, down, env)).toMatchObject({ ok: false, outcome: 'error' });
    const slow: AiProvider = { ...evil, complete: (_p, signal) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) };
    expect(await runCoachDraft({ athleteId, sources, focusNow: null }, slow, env)).toMatchObject({ ok: false, outcome: 'error' });
  });
  it('anthropic provider sends key only server-side, with configured model', async () => {
    let seen: RequestInit | undefined;
    const fake = (async (_u: string, init: RequestInit) => { seen = init; return new Response(JSON.stringify({ content: [{ type: 'text', text: '{}' }] })); }) as unknown as typeof fetch;
    const p = anthropicProvider({ ...readEnv(() => undefined), anthropicApiKey: 'test-key', aiModel: 'claude-x' }, fake);
    await p.complete({ system: 's', user: 'u' }, new AbortController().signal);
    expect(JSON.parse(String(seen!.body)).model).toBe('claude-x');
  });
});

describe('server env guards', () => {
  it('refuses live Stripe keys and SMS', () => {
    expect(() => readEnv((k) => (k === 'STRIPE_SECRET_KEY' ? 'sk_live_x' : undefined))).toThrow(/TEST/);
    expect(() => readEnv((k) => (k === 'SMS_ENABLED' ? 'true' : undefined))).toThrow(/SMS/);
  });
});

describe('Stripe webhook', () => {
  const secret = 'whsec_test';
  it('verifies signatures with tolerance and rejects tampering/replay', async () => {
    const payload = '{"id":"evt_1"}';
    const now = 1_800_000_000;
    const h = await signStripePayload(secret, payload, now);
    expect(await verifyStripeSignature(payload, h, secret, now)).toBe(true);
    expect(await verifyStripeSignature(payload + ' ', h, secret, now)).toBe(false);
    expect(await verifyStripeSignature(payload, h, secret, now + 3600)).toBe(false);
    expect(await verifyStripeSignature(payload, null, secret, now)).toBe(false);
  });
  it('rejects live events and requires server-set metadata', () => {
    const base = { id: 'evt', type: 'invoice.paid', created: 1, livemode: false, data: { object: { subscription: 'sub', customer: 'cus', metadata: { athlete_id: 'a', payer_user_id: 'p' } } } };
    expect(toDomainEvent(base)?.data.subscriptionId).toBe('sub');
    expect(() => toDomainEvent({ ...base, livemode: true })).toThrow();
    expect(toDomainEvent({ ...base, data: { object: { subscription: 'sub', customer: 'cus' } } })).toBeNull();
  });
});

describe('notification dispatch', () => {
  const job = { id: 'j1', channel: 'email' as const, recipientEmail: 'a@b.test', title: 'Time for a 90-second reflection', linkPath: '/reflect', attemptCount: 0, prefs: { quietHoursStart: 21, quietHoursEnd: 8, timezone: 'UTC', emailReminders: true }, consentActive: true };
  it('sends neutral content and records provider evidence', async () => {
    const p = mockEmailProvider();
    const u = await dispatchJob(job, p, 'https://app.test', new Date('2026-10-12T12:00:00Z'));
    expect(u).toMatchObject({ state: 'sent', providerMessageId: 'mock_j1' });
    expect(JSON.stringify(p.sent)).not.toMatch(/hesitated/);
  });
  it('defers in quiet hours, cancels without consent, retries then fails', async () => {
    const p = mockEmailProvider();
    expect((await dispatchJob(job, p, '', new Date('2026-10-12T23:00:00Z'))).state).toBe('deferred');
    expect((await dispatchJob({ ...job, consentActive: false }, p, '', new Date('2026-10-12T12:00:00Z'))).state).toBe('canceled');
    expect((await dispatchJob({ ...job, channel: 'sms' }, p, '', new Date('2026-10-12T12:00:00Z'))).state).toBe('canceled');
    const broken = { send: async () => { throw new Error('provider down'); } };
    expect((await dispatchJob(job, broken, '', new Date('2026-10-12T12:00:00Z'))).state).toBe('pending');
    expect((await dispatchJob({ ...job, attemptCount: 4 }, broken, '', new Date('2026-10-12T12:00:00Z'))).state).toBe('failed');
  });
});
