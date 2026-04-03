import { useState } from 'react';
import { useAppStore } from '../../store';
import type { Settings as SettingsType } from '../../types';
import { X, Eye, EyeOff, Wifi, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import * as ipc from '../../lib/ipc';
import styles from './SettingsModal.module.css';

export default function SettingsModal() {
  const settings = useAppStore(state => state.settings);
  const updateSettings = useAppStore(state => state.updateSettings);
  const setSettingsOpen = useAppStore(state => state.setSettingsOpen);

  const [form, setForm] = useState<SettingsType>({
    theme: settings?.theme ?? 'system',
    api_key: settings?.api_key ?? '',
    model_url: settings?.model_url ?? 'https://api.groq.com/openai/v1',
    model_name: settings?.model_name ?? 'llama3-8b-8192',
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleSave = () => {
    updateSettings(form);
    setSettingsOpen(false);
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const reply = await ipc.testConnection(form.api_key, form.model_url, form.model_name);
      setTestStatus('success');
      setTestMessage(`Connected! AI replied: "${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}"`);
    } catch (e) {
      setTestStatus('error');
      setTestMessage(String(e));
    }
  };

  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Settings</h2>
          <button className={styles.closeBtn} onClick={() => setSettingsOpen(false)} aria-label="Close settings">
            <X size={20} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.field}>
            <label htmlFor="setting-theme">Theme</label>
            <select
              id="setting-theme"
              className={styles.select}
              value={form.theme}
              onChange={e => setForm({ ...form, theme: e.target.value as SettingsType['theme'] })}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="setting-api-key">API Key (Groq)</label>
            <div className={styles.inputWrapper}>
              <input
                id="setting-api-key"
                type={showApiKey ? 'text' : 'password'}
                className={styles.inputWithToggle}
                value={form.api_key}
                onChange={e => setForm({ ...form, api_key: e.target.value })}
                placeholder="gsk_…"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className={styles.eyeToggle}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                onMouseDown={e => {
                  e.preventDefault();
                  setShowApiKey(v => !v);
                }}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="setting-model-url">Model URL</label>
            <input
              id="setting-model-url"
              className={styles.input}
              value={form.model_url}
              onChange={e => setForm({ ...form, model_url: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="setting-model-name">Model Name</label>
            <input
              id="setting-model-name"
              className={styles.input}
              value={form.model_name}
              onChange={e => setForm({ ...form, model_name: e.target.value })}
            />
          </div>

          <div className={styles.testRow}>
            <button
              className={styles.testBtn}
              onClick={handleTestConnection}
              disabled={testStatus === 'testing'}
            >
              {testStatus === 'testing' ? (
                <Loader2 size={16} className={styles.spin} />
              ) : (
                <Wifi size={16} />
              )}
              {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
            {testStatus === 'success' && (
              <div className={styles.testSuccess}>
                <CheckCircle size={14} />
                <span>{testMessage}</span>
              </div>
            )}
            {testStatus === 'error' && (
              <div className={styles.testError}>
                <XCircle size={14} />
                <span>{testMessage}</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.saveBtn} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
