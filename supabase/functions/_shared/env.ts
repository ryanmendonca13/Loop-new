/** Server-only configuration. Secrets are read from the Edge Function environment, never from requests. */
export interface ServerEnv {
  aiProvider: 'mock' | 'anthropic';
  anthropicApiKey: string | null;
  aiModel: string;
  aiTimeoutMs: number;
  aiMaxOutputTokens: number;
  aiDailyBudgetCalls: number;
  aiActionRecommendations: boolean;
  emailProvider: 'mock' | 'resend';
  emailApiKey: string | null;
  fromAddress: string;
  appBaseUrl: string;
  smsEnabled: false;
  billingEnabled: boolean;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
}

export function readEnv(get: (k: string) => string | undefined): ServerEnv {
  const provider = get('AI_PROVIDER') === 'anthropic' ? 'anthropic' : 'mock';
  const stripeKey = get('STRIPE_SECRET_KEY') ?? null;
  if (stripeKey && !stripeKey.startsWith('sk_test_')) {
    // Live keys are refused until amount, currency, tax treatment and terms are approved.
    throw new Error('Refusing to start: only Stripe TEST keys are allowed in this build.');
  }
  if (get('SMS_ENABLED') === 'true') throw new Error('SMS is a disabled later feature in this build.');
  return {
    aiProvider: provider,
    anthropicApiKey: get('ANTHROPIC_API_KEY') ?? null,
    aiModel: get('AI_MODEL') ?? 'claude-sonnet-5-5',
    aiTimeoutMs: Number(get('AI_TIMEOUT_MS') ?? 15000),
    aiMaxOutputTokens: Number(get('AI_MAX_OUTPUT_TOKENS') ?? 800),
    aiDailyBudgetCalls: Number(get('AI_DAILY_BUDGET_CALLS') ?? 200),
    aiActionRecommendations: get('AI_ACTION_RECOMMENDATIONS') === 'true',
    emailProvider: get('NOTIFY_EMAIL_PROVIDER') === 'resend' ? 'resend' : 'mock',
    emailApiKey: get('NOTIFY_EMAIL_API_KEY') ?? null,
    fromAddress: get('NOTIFY_FROM_ADDRESS') ?? 'no-reply@example.invalid',
    appBaseUrl: get('APP_BASE_URL') ?? 'http://localhost:5173',
    smsEnabled: false,
    billingEnabled: get('BILLING_ENABLED') === 'true',
    stripeSecretKey: stripeKey,
    stripeWebhookSecret: get('STRIPE_WEBHOOK_SECRET') ?? null,
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export const CORS_HEADERS = {
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
