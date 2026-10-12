import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { parseConfig } from './config';
import { ApiProvider } from './app/context';
import { AppRoutes } from './app/routes';
import { createApi } from './app/createApi';

function ConfigError({ message }: { message: string }) {
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>Loop is not configured</h1>
      <p>{message}</p>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
async function boot() {
  const config = parseConfig(import.meta.env as unknown as Record<string, unknown>);
  const api = await createApi(config);
  root.render(
    <StrictMode>
      <BrowserRouter>
        <ApiProvider api={api} config={config}>
          <AppRoutes />
        </ApiProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}
boot().catch((e: unknown) => root.render(<ConfigError message={(e as Error).message} />));
