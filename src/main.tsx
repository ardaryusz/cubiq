import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import App from './App.tsx';
import QuickAskApp from './QuickAskApp.tsx';
import './styles/global.css';

function RootComponent() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    setLabel(getCurrentWebviewWindow().label);
  }, []);

  if (!label) return null;

  return label === 'quickask' ? <QuickAskApp /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>
);
