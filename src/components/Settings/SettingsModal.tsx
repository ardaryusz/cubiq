import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../../store';
import type { Settings as SettingsType, Preset, DeletedChat } from '../../types';
import { X, Eye, Plus, Copy, Trash2, Edit2, Download, Upload, ArrowLeft, RotateCcw, Search, CheckSquare, Check } from 'lucide-react';
import * as ipc from '../../lib/ipc';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import styles from './SettingsModal.module.css';
import { AppearanceSettings } from './AppearanceSettings';
import { ApiSettings } from './ApiSettings';
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

function formatCountdown(deletedAt: number, retentionDays: number, now: number): string {
  const expiresAt = deletedAt + (retentionDays * 86400 * 1000);
  const diff = expiresAt - now;

  if (diff <= 0) return 'Deleting...';

  const days = Math.floor(diff / (86400 * 1000));
  const hours = Math.floor((diff % (86400 * 1000)) / (3600 * 1000));
  const mins = Math.floor((diff % (3600 * 1000)) / (60 * 1000));

  if (days > 0) return `Deletes in ${days}d ${hours}h`;
  if (hours > 0) return `Deletes in ${hours}h ${mins}m`;
  return `Deletes in ${mins}m`;
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

  const fileInputRef  = useRef<HTMLInputElement>(null);
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

  // ── Local Ticker for countdowns ──────────────────────────────────
  const [nowValue, setNowValue] = useState<number>(() => Date.now());

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

  // Tick every 30s while Trash tab is active to update countdowns
  useEffect(() => {
    if (activeTab !== 'trash') return;
    const interval = setInterval(() => {
      setNowValue(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // ── Trash-specific state ──────────────────────────────────────────
  const [trashSearch, setTrashSearch] = useState('');
  const [trashSelectMode, setTrashSelectMode] = useState(false);
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<number>>(new Set());
  const [lastTrashSelectedId, setLastTrashSelectedId] = useState<number | null>(null);
  const [permDeleteDialog, setPermDeleteDialog] = useState<{ ids: number[]; count: number } | null>(null);

  const filteredDeleted: DeletedChat[] = deletedChats.filter(c =>
    !trashSearch || c.title.toLowerCase().includes(trashSearch.toLowerCase())
  );

  // Exit trash select mode when tab changes
  useEffect(() => {
    if (activeTab !== 'trash') {
      // Defer so the state updates happen outside the synchronous effect body
      // (react-hooks/set-state-in-effect).
      setTimeout(() => {
        setTrashSelectMode(false);
        setTrashSelectedIds(new Set());
        setLastTrashSelectedId(null);
        setTrashSearch('');
      }, 0);
    }
  }, [activeTab]);

  // ── Trash selection handlers ──────────────────────────────────────

  const handleTrashRowClick = (e: React.MouseEvent, chat: DeletedChat) => {
    const id = chat.id;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setTrashSelectMode(true);
      setTrashSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setLastTrashSelectedId(id);
      return;
    }
    if (e.shiftKey && trashSelectMode && lastTrashSelectedId !== null) {
      e.preventDefault();
      const ids = filteredDeleted.map(c => c.id);
      const fromIdx = ids.indexOf(lastTrashSelectedId);
      const toIdx   = ids.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const range = ids.slice(lo, hi + 1);
        setTrashSelectedIds(prev => {
          const next = new Set(prev);
          range.forEach(rid => next.add(rid));
          return next;
        });
      }
      return;
    }
    if (trashSelectMode) {
      setTrashSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setLastTrashSelectedId(id);
      return;
    }
    // Non-select-mode: single restore
    // (no click-to-open for deleted chats; context actions are the buttons)
  };

  const exitTrashSelect = () => {
    setTrashSelectMode(false);
    setTrashSelectedIds(new Set());
    setLastTrashSelectedId(null);
  };

  const handleBulkRestore = async () => {
    const ids = Array.from(trashSelectedIds);
    await restoreChats(ids);
    exitTrashSelect();
  };

  const requestBulkPermDelete = () => {
    setPermDeleteDialog({ ids: Array.from(trashSelectedIds), count: trashSelectedIds.size });
  };

  const confirmPermDelete = async () => {
    if (!permDeleteDialog) return;
    await deletePermanently(permDeleteDialog.ids);
    setPermDeleteDialog(null);
    exitTrashSelect();
  };

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

  // ── Native Export / Import ────────────────────────────────────────
  const handleExportAll = async () => {
    try {
      const path = await saveDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: 'cubiq-presets.json'
      });
      if (path) {
        await ipc.exportPresetsToFile(path);
        alert('All custom presets exported successfully!');
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed or canceled.');
    }
  };

  const handleExportOne = async (id: number) => {
    const preset = presets.find(p => p.id === id);
    const fname = `cubiq-preset-${(preset?.name ?? 'preset').toLowerCase().replace(/\s+/g, '-')}.json`;
    try {
      const path = await saveDialog({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: fname
      });
      if (path) {
        await ipc.exportPresetsToFile(path, [id]);
        alert(`Preset "${preset?.name}" exported successfully!`);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed or canceled.');
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importPresets(text);
      alert('Presets imported successfully!');
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import presets. Invalid format.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
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
            <>
              <div className={styles.sectionTitle}>Default System Preset</div>
              <div className={styles.field}>
                <select className={styles.select} value={form.selected_preset_id ?? ''}
                  onChange={e => handlePresetSelectChange(e.target.value)}>
                  <option value="">— None —</option>
                  {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className={styles.sectionTitle}>Preset Manager</div>
              <div className={styles.presetList}>
                {presets.map(p => (
                  <div key={p.id} className={styles.presetItem}>
                    <span className={styles.presetName}>{p.name}</span>
                    {p.is_builtin && <span className={styles.presetBadge}>built-in</span>}
                    <div className={styles.presetActions}>
                      {p.is_builtin ? (
                        <button className={styles.presetActionBtn} title="View" onClick={() => openEditOrViewPreset(p)}><Eye size={14} /></button>
                      ) : (
                        <button className={styles.presetActionBtn} title="Edit" onClick={() => openEditOrViewPreset(p)}><Edit2 size={14} /></button>
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
                <button className={styles.toolbarBtn} onClick={openNewPreset}><Plus size={14} /> New</button>
                <button className={styles.toolbarBtn} onClick={handleImportClick}><Upload size={14} /> Import</button>
                <button className={styles.toolbarBtn} onClick={handleExportAll}><Download size={14} /> Export All</button>
              </div>
              <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
            </>
          )}

          {/* ── TRASH TAB ─── */}
          {activeTab === 'trash' && (
            <>
              {/* Retention setting */}
              <div className={styles.sectionTitle}>Retention Policy</div>
              <div className={styles.field}>
                <label htmlFor="trash-retention">Auto-delete after (days)</label>
                <div className={styles.retentionRow}>
                  <input
                    id="trash-retention"
                    type="number"
                    min={1}
                    max={365}
                    className={styles.retentionInput}
                    value={form.trash_retention_days}
                    onChange={e => {
                      const v = Math.max(1, Math.min(365, Number(e.target.value) || 7));
                      savePatch({ trash_retention_days: v });
                    }}
                  />
                  <span className={styles.retentionUnit}>days</span>
                </div>
              </div>

              {/* Toolbar */}
              <div className={styles.trashToolbar}>
                <div className={styles.searchInputWrapper}>
                  <Search size={13} className={styles.searchIcon} />
                  <input
                    className={styles.searchInput}
                    placeholder="Filter trash…"
                    value={trashSearch}
                    onChange={e => setTrashSearch(e.target.value)}
                  />
                  {trashSearch && (
                    <button className={styles.searchClearBtn} onClick={() => setTrashSearch('')}><X size={12} /></button>
                  )}
                </div>

                <button
                  className={`${styles.toolbarBtn} ${trashSelectMode ? styles.toolbarBtnActive : ''}`}
                  onClick={() => trashSelectMode ? exitTrashSelect() : setTrashSelectMode(true)}
                  title={trashSelectMode ? 'Exit select mode' : 'Select chats'}
                >
                  <CheckSquare size={14} /> Select
                </button>
              </div>

              {/* Bulk action bar */}
              {trashSelectMode && trashSelectedIds.size > 0 && (
                <div className={styles.trashBulkBar}>
                  <span className={styles.trashBulkCount}>{trashSelectedIds.size} selected</span>
                  <button className={styles.trashBulkBtn} onClick={handleBulkRestore}>
                    <RotateCcw size={13} /> Restore
                  </button>
                  <button
                    className={`${styles.trashBulkBtn} ${styles.trashBulkBtnDanger}`}
                    onClick={requestBulkPermDelete}
                  >
                    <Trash2 size={13} /> Delete permanently
                  </button>
                </div>
              )}

              {/* Trash list */}
              <div className={styles.trashList}>
                {filteredDeleted.length === 0 ? (
                  <div className={styles.trashEmpty}>
                    {trashSearch ? 'No matches in Trash.' : 'Trash is empty.'}
                  </div>
                ) : (
                  filteredDeleted.map(chat => {
                    const selected = trashSelectedIds.has(chat.id);
                    return (
                      <div
                        key={chat.id}
                        className={`${styles.trashItem} ${selected ? styles.trashItemSelected : ''}`}
                        onClick={e => handleTrashRowClick(e, chat)}
                      >
                        {trashSelectMode && (
                          <span className={`${styles.trashCheckbox} ${selected ? styles.trashCheckboxChecked : ''}`}>
                            {selected && <Check size={11} />}
                          </span>
                        )}
                        <span className={styles.trashItemTitle}>{chat.title}</span>
                        <span className={styles.trashItemDate}>
                          {formatCountdown(chat.deleted_at, form.trash_retention_days, nowValue)}
                        </span>
                        {!trashSelectMode && (
                          <div className={styles.trashItemActions}>
                            <button
                              className={styles.trashActionBtn}
                              title="Restore"
                              onClick={e => { e.stopPropagation(); restoreChats([chat.id]); }}
                            >
                              <RotateCcw size={13} />
                            </button>
                            <button
                              className={`${styles.trashActionBtn} ${styles.trashActionBtnDanger}`}
                              title="Delete permanently"
                              onClick={e => {
                                e.stopPropagation();
                                setPermDeleteDialog({ ids: [chat.id], count: 1 });
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Permanent delete confirmation */}
              {permDeleteDialog && (
                <div className={styles.trashPermDialog}>
                  <div className={styles.trashPermDialogBox}>
                    <div className={styles.trashPermDialogTitle}>
                      Permanently delete {permDeleteDialog.count} chat{permDeleteDialog.count > 1 ? 's' : ''}?
                    </div>
                    <div className={styles.trashPermDialogBody}>
                      This cannot be undone. The chat{permDeleteDialog.count > 1 ? 's' : ''} and all their messages will be erased forever.
                    </div>
                    <div className={styles.trashPermDialogActions}>
                      <button className={styles.editorCancelBtn} onClick={() => setPermDeleteDialog(null)}>Cancel</button>
                      <button className={styles.trashPermDeleteBtn} onClick={confirmPermDelete}>
                        Delete permanently
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
