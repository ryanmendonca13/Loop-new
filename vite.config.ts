import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Server-only variable names that must never be exposed to the browser bundle.
const FORBIDDEN_BROWSER_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN',
  'NOTIFY_EMAIL_API_KEY',
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  for (const name of FORBIDDEN_BROWSER_VARS) {
    if (`VITE_${name}` in env) {
      throw new Error(`Refusing to build: VITE_${name} would expose a server secret to the browser.`);
    }
  }
  return {
    plugins: [react(), tailwindcss()],
    envPrefix: 'VITE_',
    build: { sourcemap: mode !== 'production', target: 'es2022' },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
