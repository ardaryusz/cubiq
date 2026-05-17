import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store';
import type { Settings as SettingsType, Preset } from '../../types';
import { X, ArrowLeft } from 'lucide-react';
import styles from './SettingsModal.module.css';
import { AppearanceSettings } from './AppearanceSettings';
import { ApiSettings } from './ApiSettings';
import { PresetsSettings } from './PresetsSettings';
import { TrashSettings } from './TrashSettings';
import { MODEL_OPTIONS } from './constants';

type View = 'main' | 'editPreset' | 'viewPreset';
type Tab = 'appearance' | 'api' | 'presets' | 'trash';

interface PresetEditorState {
  id: number | null;
  name: string;
  modelUrl: string;
  modelName: string;
  useCustomModel: boolean;
  customModelName: string;
  customizationPrompt: string;
  isBuiltin: boolean;
}


export default function SettingsModal() {
  const settings = useAppStore(state => state.settings);
  const presets   = useAppStore(state => state.presets);
  const deletedChats = useAppStore(state => state.deletedChats);
  const updateSettings   = useAppStore(state => state.updateSettings);
  const setSettingsOpen  = useAppStore(state => state.setSettingsOpen);
  const createPreset     = useAppStore(state => state.createPreset);
  const updatePreset     = useAppStore(state => state.updatePreset);
  const deletePreset     = useAppStore(state => state.deletePreset);
  const duplicatePreset  = useAppStore(state => state.duplicatePreset);
  const importPresets    = useAppStore(state => state.importPresets);
  const restoreChats     = useAppStore(state => state.restoreChats);
  const deletePermanently = useAppStore(state => state.deletePermanently);
  const purgeExpired     = useAppStore(state => state.purgeExpiredDeletedChats);

  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [form, setForm] = useState<SettingsType>({
    theme: settings?.theme ?? 'system',
    app_theme: settings?.app_theme ?? 'cubiq-dark',
    accent_theme: settings?.accent_theme ?? 'emerald',
    api_key: settings?.api_key ?? '',
    model_url: settings?.model_url ?? 'https://api.groq.com/openai/v1',
    model_name: settings?.model_name ?? 'llama-3.3-70b-versatile',
    selected_preset_id: settings?.selected_preset_id,
    trash_retention_days: settings?.trash_retention_days ?? 7,
  });

  const [activeTab, setActiveTab] = useState<Tab>('appearance');
  const [view, setView] = useState<View>('main');
  const [editor, setEditor] = useState<PresetEditorState | null>(null);

  // Trigger purge and refresh whenever Trash is selected OR Settings opens
  useEffect(() => {
    // We only trigger if tab is trash OR when we first mount (opens settings)
    const runPurge = async () => {
      await purgeExpired();
      // If we are currently looking at trash, refresh the list too
      if (activeTab === 'trash') {
        useAppStore.getState().refreshDeletedChats();
        useAppStore.getState().refreshFolders(); // for badge counts
      }
    };
    runPurge();
  }, [activeTab, purgeExpired]);

  // ── Auto-save helpers ─────────────────────────────────────────────

  const savePatch = useCallback((patch: Partial<SettingsType>) => {
    const merged = { ...form, ...patch };
    setForm(merged);
    updateSettings(merged);
  }, [form, updateSettings]);

  const saveNow = useCallback((currentForm: SettingsType) => {
    updateSettings(currentForm);
  }, [updateSettings]);

  const handleTextChange = useCallback((patch: Partial<SettingsType>) => {
    const merged = { ...form, ...patch };
    setForm(merged);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveNow(merged), 400);
  }, [form, saveNow]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── Theme ─────────────────────────────────────────────────────────
  const handleThemeChange = async (themeId: string) => {
    savePatch({ app_theme: themeId });
  };

  const handlePresetSelectChange = (value: string) => {
    savePatch({ selected_preset_id: value ? Number(value) : undefined });
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
      isBuiltin: false,
    });
    setView('editPreset');
  };

  const openEditOrViewPreset = (p: Preset) => {
    const isCustomModel = !MODEL_OPTIONS.includes(p.model_name);
    setEditor({
      id: p.id ?? null,
      name: p.name,
      modelUrl: p.model_url,
      modelName: isCustomModel ? MODEL_OPTIONS[0] : p.model_name,
      useCustomModel: isCustomModel || !!p.custom_model_name,
      customModelName: p.custom_model_name ?? (isCustomModel ? p.model_name : ''),
      customizationPrompt: p.customization_prompt,
      isBuiltin: p.is_builtin,
    });
    setView(p.is_builtin ? 'viewPreset' : 'editPreset');
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

  // ── Preset Editor & View ──────────────────────────────────────────
  if ((view === 'editPreset' || view === 'viewPreset') && editor) {
    const isReadOnly = view === 'viewPreset';
    return (
      <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.headerTop}>
              <h2>{isReadOnly ? 'Preset Details' : (editor.id ? 'Edit Preset' : 'New Preset')}</h2>
              <button className={styles.closeBtn} onClick={() => setSettingsOpen(false)} aria-label="Close"><X size={20} /></button>
            </div>
          </div>
          <div className={styles.content}>
            <button className={styles.editorBackBtn} onClick={() => { setView('main'); setEditor(null); }}>
              <ArrowLeft size={14} /> Back to Settings
            </button>

            <div className={styles.field}>
              <label>Preset Name</label>
              {isReadOnly ? <div className={styles.readOnlyValue}>{editor.name}</div>
                : <input className={styles.input} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} placeholder="My Custom Preset" />}
            </div>

            <div className={styles.field}>
              <label>Model URL</label>
              {isReadOnly ? <div className={styles.readOnlyValue}>{editor.modelUrl}</div>
                : <input className={styles.input} value={editor.modelUrl} onChange={e => setEditor({ ...editor, modelUrl: e.target.value })} />}
            </div>

            <div className={styles.field}>
              <label>Model</label>
              {isReadOnly ? <div className={styles.readOnlyValue}>{editor.useCustomModel ? editor.customModelName : editor.modelName}</div>
                : <select className={styles.select} value={editor.modelName} onChange={e => setEditor({ ...editor, modelName: e.target.value })}>
                    {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
              }
            </div>

            {!isReadOnly && (
              <div className={styles.checkboxRow}>
                <input type="checkbox" id="custom-model-check" checked={editor.useCustomModel} onChange={e => setEditor({ ...editor, useCustomModel: e.target.checked })} />
                <label htmlFor="custom-model-check">Custom model name override</label>
              </div>
            )}

            {!isReadOnly && editor.useCustomModel && (
              <div className={styles.field}>
                <input className={styles.input} value={editor.customModelName} onChange={e => setEditor({ ...editor, customModelName: e.target.value })} placeholder="custom-model-name" />
              </div>
            )}

            <div className={styles.field}>
              <label>Customization Prompt</label>
              {isReadOnly ? <div className={styles.readOnlyValue}>{editor.customizationPrompt || '(No prompt defined)'}</div>
                : <textarea className={styles.editorTextarea} value={editor.customizationPrompt} onChange={e => setEditor({ ...editor, customizationPrompt: e.target.value })} placeholder="Instructions for how the AI should behave..." rows={4} />}
            </div>

            <div className={styles.editorActions}>
              <button className={styles.editorCancelBtn} onClick={() => { setView('main'); setEditor(null); }}>
                {isReadOnly ? 'Close' : 'Cancel'}
              </button>
              {!isReadOnly && (
                <button className={styles.editorSaveBtn} onClick={handleSavePreset} disabled={!editor.name.trim()}>Save Preset</button>
              )}
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
          <div className={styles.headerTop}>
            <h2>Settings</h2>
            <button className={styles.closeBtn} onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={20} /></button>
          </div>
          <div className={styles.tabs}>
            <div className={`${styles.tab} ${activeTab === 'appearance' ? styles.tabActive : ''}`} onClick={() => setActiveTab('appearance')}>Appearance</div>
            <div className={`${styles.tab} ${activeTab === 'api' ? styles.tabActive : ''}`} onClick={() => setActiveTab('api')}>API</div>
            <div className={`${styles.tab} ${activeTab === 'presets' ? styles.tabActive : ''}`} onClick={() => setActiveTab('presets')}>Presets</div>
            <div className={`${styles.tab} ${activeTab === 'trash' ? styles.tabActive : ''}`} onClick={() => setActiveTab('trash')}>
              Trash {deletedChats.length > 0 && <span className={styles.trashBadge}>{deletedChats.length}</span>}
            </div>
          </div>
        </div>

        <div className={styles.content}>

          {/* ── APPEARANCE TAB ─── */}
          {activeTab === 'appearance' && (
            <AppearanceSettings
              activeTheme={form.app_theme}
              onThemeChange={handleThemeChange}
            />
          )}

          {/* ── API TAB ─── */}
          {activeTab === 'api' && (
            <ApiSettings
              form={form}
              onTextChange={handleTextChange}
              onSaveNow={saveNow}
              onSavePatch={savePatch}
            />
          )}

          {/* ── PRESETS TAB ─── */}
          {activeTab === 'presets' && (
            <PresetsSettings
              presets={presets}
              selectedPresetId={form.selected_preset_id}
              onSelectPreset={handlePresetSelectChange}
              onNewPreset={openNewPreset}
              onEditOrViewPreset={openEditOrViewPreset}
              onDuplicatePreset={duplicatePreset}
              onDeletePreset={deletePreset}
              onImportPresets={importPresets}
            />
          )}

          {/* ── TRASH TAB ─── */}
          {activeTab === 'trash' && (
            <TrashSettings
              deletedChats={deletedChats}
              retentionDays={form.trash_retention_days}
              onRetentionChange={v => savePatch({ trash_retention_days: v })}
              onRestore={restoreChats}
              onDeletePermanently={deletePermanently}
            />
          )}

        </div>
      </div>
    </div>
  );
}
