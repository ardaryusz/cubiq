import { X, ArrowLeft } from 'lucide-react';
import styles from './SettingsModal.module.css';
import { MODEL_OPTIONS } from './constants';

export interface PresetEditorState {
  id: number | null;
  name: string;
  modelUrl: string;
  modelName: string;
  useCustomModel: boolean;
  customModelName: string;
  customizationPrompt: string;
  isBuiltin: boolean;
}

interface PresetEditorProps {
  editor: PresetEditorState;
  isReadOnly: boolean;
  onChange: (editor: PresetEditorState) => void;
  onSave: () => void;
  onCancel: () => void;
  onCloseGlobal: () => void;
}

export function PresetEditor({
  editor,
  isReadOnly,
  onChange,
  onSave,
  onCancel,
  onCloseGlobal
}: PresetEditorProps) {
  return (
    <div className={styles.overlay} onClick={e => { if (e.target === e.currentTarget) onCloseGlobal(); }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <h2>{isReadOnly ? 'Preset Details' : (editor.id ? 'Edit Preset' : 'New Preset')}</h2>
            <button className={styles.closeBtn} onClick={onCloseGlobal} aria-label="Close"><X size={20} /></button>
          </div>
        </div>
        <div className={styles.content}>
          <button className={styles.editorBackBtn} onClick={onCancel}>
            <ArrowLeft size={14} /> Back to Settings
          </button>

          <div className={styles.field}>
            <label>Preset Name</label>
            {isReadOnly ? <div className={styles.readOnlyValue}>{editor.name}</div>
              : <input className={styles.input} value={editor.name} onChange={e => onChange({ ...editor, name: e.target.value })} placeholder="My Custom Preset" />}
          </div>

          <div className={styles.field}>
            <label>Model URL</label>
            {isReadOnly ? <div className={styles.readOnlyValue}>{editor.modelUrl}</div>
              : <input className={styles.input} value={editor.modelUrl} onChange={e => onChange({ ...editor, modelUrl: e.target.value })} />}
          </div>

          <div className={styles.field}>
            <label>Model</label>
            {isReadOnly ? <div className={styles.readOnlyValue}>{editor.useCustomModel ? editor.customModelName : editor.modelName}</div>
              : <select className={styles.select} value={editor.modelName} onChange={e => onChange({ ...editor, modelName: e.target.value })}>
                  {MODEL_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
            }
          </div>

          {!isReadOnly && (
            <div className={styles.checkboxRow}>
              <input type="checkbox" id="custom-model-check" checked={editor.useCustomModel} onChange={e => onChange({ ...editor, useCustomModel: e.target.checked })} />
              <label htmlFor="custom-model-check">Custom model name override</label>
            </div>
          )}

          {!isReadOnly && editor.useCustomModel && (
            <div className={styles.field}>
              <input className={styles.input} value={editor.customModelName} onChange={e => onChange({ ...editor, customModelName: e.target.value })} placeholder="custom-model-name" />
            </div>
          )}

          <div className={styles.field}>
            <label>Customization Prompt</label>
            {isReadOnly ? <div className={styles.readOnlyValue}>{editor.customizationPrompt || '(No prompt defined)'}</div>
              : <textarea className={styles.editorTextarea} value={editor.customizationPrompt} onChange={e => onChange({ ...editor, customizationPrompt: e.target.value })} placeholder="Instructions for how the AI should behave..." rows={4} />}
          </div>

          <div className={styles.editorActions}>
            <button className={styles.editorCancelBtn} onClick={onCancel}>
              {isReadOnly ? 'Close' : 'Cancel'}
            </button>
            {!isReadOnly && (
              <button className={styles.editorSaveBtn} onClick={onSave} disabled={!editor.name.trim()}>Save Preset</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
