import { useState } from 'react';
import type { Settings as SettingsType } from '../../types';
import { Eye, EyeOff, Wifi, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import * as ipc from '../../lib/ipc';
import styles from './SettingsModal.module.css';
import { MODEL_OPTIONS } from './constants';

interface ApiSettingsProps {
  form: SettingsType;
  onTextChange: (patch: Partial<SettingsType>) => void;
  onSaveNow: (form: SettingsType) => void;
  onSavePatch: (patch: Partial<SettingsType>) => void;
}

export function ApiSettings({ form, onTextChange, onSaveNow, onSavePatch }: ApiSettingsProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

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
    <>
      <div className={styles.sectionTitle}>API Credentials</div>
      <div className={styles.field}>
        <label htmlFor="setting-api-key">Groq API Key</label>
        <div className={styles.inputWrapper}>
          <input
            id="setting-api-key"
            type={showApiKey ? 'text' : 'password'}
            className={styles.inputWithToggle}
            value={form.api_key}
            onChange={e => onTextChange({ api_key: e.target.value })}
            onBlur={() => onSaveNow(form)}
            placeholder="gsk_…"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className={styles.eyeToggle}
            aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
            onMouseDown={e => { e.preventDefault(); setShowApiKey(v => !v); }}>
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
          onChange={e => onTextChange({ model_url: e.target.value })}
          onBlur={() => onSaveNow(form)}
          placeholder="https://api.groq.com/openai/v1"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="setting-model-name">Default Model</label>
        <select
          id="setting-model-name"
          className={styles.select}
          value={form.model_name}
          onChange={e => onSavePatch({ model_name: e.target.value })}
        >
          {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className={styles.sectionTitle}>Test Connection</div>
      <div className={styles.field}>
        <label>Connection Diagnostic</label>
        <div className={styles.testRow}>
          <button className={styles.testBtn} onClick={handleTestConnection} disabled={testStatus === 'testing'}>
            {testStatus === 'testing' ? <Loader2 size={16} className={styles.spin} /> : <Wifi size={16} />}
            {testStatus === 'testing' ? 'Testing…' : 'Test API Key'}
          </button>
          {testStatus === 'success' && (
            <div className={styles.testSuccess}><CheckCircle size={14} /><span>{testMessage}</span></div>
          )}
          {testStatus === 'error' && (
            <div className={styles.testError}><XCircle size={14} /><span>{testMessage}</span></div>
          )}
        </div>
      </div>
    </>
  );
}
