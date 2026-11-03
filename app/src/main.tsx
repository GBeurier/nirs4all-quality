import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import { I18nProvider } from '@/i18n';
import { LabProvider } from '@/store/store';
import { makeDemoState } from '@/store/demo';
import './styles/index.css';
import { initializeDiagnostics } from '@/engine/nativeDiagnostics';

const root = createRoot(document.getElementById('root')!);
root.render(<main role="status">Chargement du moteur scientifique… / Loading scientific engine…</main>);
initializeDiagnostics().then(() => root.render(
  <StrictMode>
    <I18nProvider>
      <LabProvider initial={makeDemoState()}>
        <App />
      </LabProvider>
    </I18nProvider>
  </StrictMode>,
)).catch(() => root.render(<main role="alert">Le moteur scientifique est indisponible. Rechargez la page pour réessayer. / Scientific engine unavailable. Reload to retry.</main>));
