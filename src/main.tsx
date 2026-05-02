import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import App from './App.tsx';
import QuickAskApp from './QuickAskApp.tsx';
import { setupLinkInterceptor } from './utils/externalLinks';
import './styles/global.css';

// Install the global external-link interceptor once, at module load time.
// This intentionally runs outside React so it is unaffected by StrictMode
// double-invoking effects and is safe across HMR reloads.
setupLinkInterceptor();

// getCurrentWebviewWindow().label is synchronous — read it once here and
// render the correct root directly, avoiding useState/useEffect entirely.
const label = getCurrentWebviewWindow().label;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {label === 'quickask' ? <QuickAskApp /> : <App />}
  </StrictMode>
);
