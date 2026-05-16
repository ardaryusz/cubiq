import { useRef } from 'react';
import type { Preset } from '../../types';
import { Eye, Plus, Copy, Trash2, Edit2, Download, Upload } from 'lucide-react';
import * as ipc from '../../lib/ipc';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import styles from './SettingsModal.module.css';

interface PresetsSettingsProps {
  presets: Preset[];
  selectedPresetId?: number;
  onSelectPreset: (id: string) => void;
  onNewPreset: () => void;
  onEditOrViewPreset: (p: Preset) => void;
  onDuplicatePreset: (id: number) => void;
  onDeletePreset: (id: number) => void;
  onImportPresets: (text: string) => Promise<number[] | null>;
}

export function PresetsSettings({
  presets,
  selectedPresetId,
  onSelectPreset,
  onNewPreset,
  onEditOrViewPreset,
  onDuplicatePreset,
  onDeletePreset,
  onImportPresets
}: PresetsSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      await onImportPresets(text);
      alert('Presets imported successfully!');
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import presets. Invalid format.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      <div className={styles.sectionTitle}>Default System Preset</div>
      <div className={styles.field}>
        <select className={styles.select} value={selectedPresetId ?? ''}
          onChange={e => onSelectPreset(e.target.value)}>
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
                <button className={styles.presetActionBtn} title="View" onClick={() => onEditOrViewPreset(p)}><Eye size={14} /></button>
              ) : (
                <button className={styles.presetActionBtn} title="Edit" onClick={() => onEditOrViewPreset(p)}><Edit2 size={14} /></button>
              )}
              <button className={styles.presetActionBtn} title="Duplicate" onClick={() => p.id && onDuplicatePreset(p.id)}><Copy size={14} /></button>
              {!p.is_builtin && (
                <button className={styles.presetActionBtn} title="Export" onClick={() => p.id && handleExportOne(p.id)}><Download size={14} /></button>
              )}
              {!p.is_builtin && (
                <button className={`${styles.presetActionBtn} ${styles.presetActionBtnDanger}`} title="Delete"
                  onClick={() => { if (p.id && confirm(`Delete "${p.name}"?`)) onDeletePreset(p.id); }}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.presetToolbar}>
        <button className={styles.toolbarBtn} onClick={onNewPreset}><Plus size={14} /> New</button>
        <button className={styles.toolbarBtn} onClick={handleImportClick}><Upload size={14} /> Import</button>
        <button className={styles.toolbarBtn} onClick={handleExportAll}><Download size={14} /> Export All</button>
      </div>
      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImportFile} />
    </>
  );
}
