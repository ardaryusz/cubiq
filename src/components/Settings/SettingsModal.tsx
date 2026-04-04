import { useState, useRef } from 'react';
import { useAppStore } from '../../store';
import type { Settings as SettingsType, Preset } from '../../types';
import { X, Eye, EyeOff, Wifi, CheckCircle, XCircle, Loader2, Plus, Copy, Trash2, Edit2, Download, Upload, ArrowLeft } from 'lucide-react';
import * as ipc from '../../lib/ipc';
import styles from './SettingsModal.module.css';

const ACCENT_THEMES = [
  { id: 'emerald', light: '#10a37f', dark: '#10a37f' },
  { id: 'violet',  light: '#7c3aed', dark: '#a78bfa' },
  { id: 'ocean',   light: '#0ea5e9', dark: '#38bdf8' },
  { id: 'rose',    light: '#f43f5e', dark: '#fb7185' },
  { id: 'amber',   light: '#d97706', dark: '#fbbf24' },
  { id: 'slate',   light: '#64748b', dark: '#94a3b8' },
];

const MODEL_OPTIONS = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
];

type View = 'main' | 'editPreset';

interface PresetEditorState {
  id: number | null;          // null = creating new
  name: string;
  modelUrl: string;
  modelName: string;
  useCustomModel: boolean;
  customModelName: string;
  customizationPrompt: string;
}

export default function SettingsModal() {
  const settings = useAppStore(state => state.settings);
  const presets = useAppStore(state => state.presets);
  const updateSettings = useAppStore(state => state.updateSettings);
  const setSettingsOpen = useAppStore(state => state.setSettingsOpen);
  const createPreset = useAppStore(state => state.createPreset);
  const updatePreset = useAppStore(state => state.updatePreset);
  const deletePreset = useAppStore(state => state.deletePreset);
  const duplicatePreset = useAppStore(state => state.duplicatePreset);
  const exportPresets = useAppStore(state => state.exportPresets);
  const importPresets = useAppStore(state => state.importPresets);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<SettingsType>({
    theme: settings?.theme ?? 'system',
    accent_theme: settings?.accent_theme ?? 'emerald',
    api_key: settings?.api_key ?? '',
    model_url: settings?.model_url ?? 'https://api.groq.com/openai/v1',
    model_name: settings?.model_name ?? 'llama-3.3-70b-versatile',
    selected_preset_id: settings?.selected_preset_id,
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [view, setView] = useState<View>('main');
  const [editor, setEditor] = useState<PresetEditorState | null>(null);

  const isDark = document.documentElement.classList.contains('dark');

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

  // ── Accent theme ───────────────────────────────────────────────────
  const handleAccentChange = (accentId: string) => {
    setForm({ ...form, accent_theme: accentId });
    // Apply immediately for preview
    const classes = document.documentElement.classList;
    const toRemove: string[] = [];
    classes.forEach(c => { if (c.startsWith('accent-')) toRemove.push(c); });
    toRemove.forEach(c => classes.remove(c));
    if (accentId !== 'emerald') classes.add(`accent-${accentId}`);
  };

  // ── Preset editor ─────────────────────────────────────────────────
  const openNewPreset = () => {
    setEditor({
      id: null,
      name: '',
      modelUrl: 'https://api.groq.com/openai/v1',
      modelName: 'llama-3.3-70b-versatile',
      useCustomModel: false,
      customModelName: '',
      customizationPrompt: '',
    });
    setView('editPreset');
  };

  const openEditPreset = (p: Preset) => {
    const isCustomModel = !MODEL_OPTIONS.includes(p.model_name);
    setEditor({
      id: p.id ?? null,
      name: p.name,
      modelUrl: p.model_url,
      modelName: isCustomModel ? MODEL_OPTIONS[0] : p.model_name,
      useCustomModel: isCustomModel || !!p.custom_model_name,
      customModelName: p.custom_model_name ?? (isCustomModel ? p.model_name : ''),
      customizationPrompt: p.customization_prompt,
    });
    setView('editPreset');
  };

  const handleSavePreset = async () => {
    if (!editor || !editor.name.trim()) return;
    const finalModelName = editor.useCustomModel && editor.customModelName.trim()
      ? editor.customModelName.trim()
      : editor.modelName;
    const customModelName = editor.useCustomModel && editor.customModelName.trim()
      ? editor.customModelName.trim()
      : null;

    if (editor.id) {
      await updatePreset(editor.id, editor.name.trim(), editor.modelUrl, finalModelName, customModelName, editor.customizationPrompt);
    } else {
      await createPreset(editor.name.trim(), editor.modelUrl, finalModelName, customModelName, editor.customizationPrompt);
    }
    setView('main');
    setEditor(null);
  };

  // ── Import/Export ─────────────────────────────────────────────────
  const handleExportAll = async () => {
    const json = await exportPresets();
    if (json) downloadJson(json, 'cubiq-presets.json');
  };

  const handleExportOne = async (id: number) => {
    const json = await exportPresets([id]);
    if (json) {
      const preset = presets.find(p => p.id === id);
      const fname = `cubiq-preset-${(preset?.name ?? 'preset').toLowerCase().replace(/\s+/g, '-')}.json`;
      downloadJson(json, fname);
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importPresets(text);
    } catch (err) {
      console.error('Import failed:', err);
    }
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  function downloadJson(json: string, filename: string) {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Preset Editor View ────────────────────────────────────────────
  if (view === 'editPreset' && editor) {
    return (
      <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <h2>{editor.id ? 'Edit Preset' : 'New Preset'}</h2>
            <button className={styles.closeBtn} onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={20} /></button>
          </div>
          <div className={styles.content}>
            <button className={styles.editorBackBtn} onClick={() => { setView('main'); setEditor(null); }}>
              <ArrowLeft size={14} /> Back to Settings
            </button>

            <div className={styles.field}>
              <label>Preset Name</label>
              <input className={styles.input} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} placeholder="My Custom Preset" />
            </div>

            <div className={styles.field}>
              <label>Model URL</label>
              <input className={styles.input} value={editor.modelUrl} onChange={e => setEditor({ ...editor, modelUrl: e.target.value })} />
            </div>

            <div className={styles.field}>
              <label>Model</label>
              <select className={styles.select} value={editor.modelName} onChange={e => setEditor({ ...editor, modelName: e.target.value })}>
                {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className={styles.checkboxRow}>
              <input type="checkbox" id="custom-model-check" checked={editor.useCustomModel} onChange={e => setEditor({ ...editor, useCustomModel: e.target.checked })} />
              <label htmlFor="custom-model-check">Custom model name override</label>
            </div>
            {editor.useCustomModel && (
              <div className={styles.field}>
                <input className={styles.input} value={editor.customModelName} onChange={e => setEditor({ ...editor, customModelName: e.target.value })} placeholder="custom-model-name" />
              </div>
            )}

            <div className={styles.field}>
              <label>Customization Prompt</label>
              <textarea className={styles.editorTextarea} value={editor.customizationPrompt} onChange={e => setEditor({ ...editor, customizationPrompt: e.target.value })} placeholder="Instructions for how the AI should behave..." rows={4} />
            </div>

            <div className={styles.editorActions}>
              <button className={styles.editorCancelBtn} onClick={() => { setView('main'); setEditor(null); }}>Cancel</button>
              <button className={styles.editorSaveBtn} onClick={handleSavePreset} disabled={!editor.name.trim()}>Save Preset</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Settings View ────────────────────────────────────────────
  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Settings</h2>
          <button className={styles.closeBtn} onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={20} /></button>
        </div>

        <div className={styles.content}>
          {/* ── APPEARANCE ─── */}
          <div className={styles.sectionTitle}>Appearance</div>

          <div className={styles.field}>
            <label htmlFor="setting-theme">Theme Mode</label>
            <select id="setting-theme" className={styles.select} value={form.theme}
              onChange={e => setForm({ ...form, theme: e.target.value as SettingsType['theme'] })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className={styles.field}>
            <label>Accent Theme</label>
            <div className={styles.accentRow}>
              {ACCENT_THEMES.map(t => (
                <button
                  key={t.id}
                  className={`${styles.accentDot} ${form.accent_theme === t.id ? styles.accentDotActive : ''}`}
                  style={{ backgroundColor: isDark ? t.dark : t.light }}
                  onClick={() => handleAccentChange(t.id)}
                  title={t.id.charAt(0).toUpperCase() + t.id.slice(1)}
                  aria-label={`Accent theme: ${t.id}`}
                />
              ))}
            </div>
          </div>

          {/* ── API ─── */}
          <div className={styles.sectionTitle}>API</div>

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
              <button type="button" className={styles.eyeToggle}
                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                onMouseDown={e => { e.preventDefault(); setShowApiKey(v => !v); }}>
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className={styles.testRow}>
            <button className={styles.testBtn} onClick={handleTestConnection} disabled={testStatus === 'testing'}>
              {testStatus === 'testing' ? <Loader2 size={16} className={styles.spin} /> : <Wifi size={16} />}
              {testStatus === 'testing' ? 'Testing…' : 'Test Connection'}
            </button>
            {testStatus === 'success' && (
              <div className={styles.testSuccess}><CheckCircle size={14} /><span>{testMessage}</span></div>
            )}
            {testStatus === 'error' && (
              <div className={styles.testError}><XCircle size={14} /><span>{testMessage}</span></div>
            )}
          </div>

          {/* ── DEFAULT PRESET ─── */}
          <div className={styles.sectionTitle}>Default Preset</div>

          <div className={styles.field}>
            <select className={styles.select} value={form.selected_preset_id ?? ''}
              onChange={e => setForm({ ...form, selected_preset_id: e.target.value ? Number(e.target.value) : undefined })}>
              <option value="">— None —</option>
              {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* ── PRESET MANAGER ─── */}
          <div className={styles.sectionTitle}>Preset Manager</div>

          <div className={styles.presetList}>
            {presets.map(p => (
              <div key={p.id} className={styles.presetItem}>
                <span className={styles.presetName}>{p.name}</span>
                {p.is_builtin && <span className={styles.presetBadge}>built-in</span>}
                <div className={styles.presetActions}>
                  {!p.is_builtin && (
                    <button className={styles.presetActionBtn} title="Edit" onClick={() => openEditPreset(p)}><Edit2 size={14} /></button>
                  )}
                  <button className={styles.presetActionBtn} title="Duplicate" onClick={() => p.id && duplicatePreset(p.id)}><Copy size={14} /></button>
                  {!p.is_builtin && (
                    <button className={styles.presetActionBtn} title="Export" onClick={() => p.id && handleExportOne(p.id)}><Download size={14} /></button>
                  )}
                  {!p.is_builtin && (
                    <button className={`${styles.presetActionBtn} ${styles.presetActionBtnDanger}`} title="Delete"
                      onClick={() => { if (p.id && confirm(`Delete "${p.name}"?`)) deletePreset(p.id); }}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={styles.presetToolbar}>
            <button className={styles.toolbarBtn} onClick={openNewPreset}><Plus size={14} /> New Preset</button>
            <button className={styles.toolbarBtn} onClick={handleImportClick}><Upload size={14} /> Import</button>
            <button className={styles.toolbarBtn} onClick={handleExportAll}><Download size={14} /> Export All</button>
          </div>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
        </div>

        <div className={styles.footer}>
          <button className={styles.saveBtn} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
