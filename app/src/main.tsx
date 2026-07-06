import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import { I18nProvider } from '@/i18n';
import { LabProvider } from '@/store/store';
import { makeDemoState } from '@/store/demo';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <LabProvider initial={makeDemoState()}>
        <App />
      </LabProvider>
    </I18nProvider>
  </StrictMode>,
);
