import { useState, useEffect } from 'react';
import type { DeletedChat } from '../../types';
import { Search, X, CheckSquare, RotateCcw, Trash2, Check } from 'lucide-react';
import styles from './SettingsModal.module.css';

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

interface TrashSettingsProps {
  deletedChats: DeletedChat[];
  retentionDays: number;
  onRetentionChange: (days: number) => void;
  onRestore: (ids: number[]) => Promise<void>;
  onDeletePermanently: (ids: number[]) => Promise<void>;
}

export function TrashSettings({
  deletedChats,
  retentionDays,
  onRetentionChange,
  onRestore,
  onDeletePermanently
}: TrashSettingsProps) {
  const [nowValue, setNowValue] = useState<number>(() => Date.now());
  const [trashSearch, setTrashSearch] = useState('');
  const [trashSelectMode, setTrashSelectMode] = useState(false);
  const [trashSelectedIds, setTrashSelectedIds] = useState<Set<number>>(new Set());
  const [lastTrashSelectedId, setLastTrashSelectedId] = useState<number | null>(null);
  const [permDeleteDialog, setPermDeleteDialog] = useState<{ ids: number[]; count: number } | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowValue(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredDeleted: DeletedChat[] = deletedChats.filter(c =>
    !trashSearch || c.title.toLowerCase().includes(trashSearch.toLowerCase())
  );

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
  };

  const exitTrashSelect = () => {
    setTrashSelectMode(false);
    setTrashSelectedIds(new Set());
    setLastTrashSelectedId(null);
  };

  const handleBulkRestore = async () => {
    const ids = Array.from(trashSelectedIds);
    await onRestore(ids);
    exitTrashSelect();
  };

  const requestBulkPermDelete = () => {
    setPermDeleteDialog({ ids: Array.from(trashSelectedIds), count: trashSelectedIds.size });
  };

  const confirmPermDelete = async () => {
    if (!permDeleteDialog) return;
    await onDeletePermanently(permDeleteDialog.ids);
    setPermDeleteDialog(null);
    exitTrashSelect();
  };

  return (
    <>
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
            value={retentionDays}
            onChange={e => {
              const v = Math.max(1, Math.min(365, Number(e.target.value) || 7));
              onRetentionChange(v);
            }}
          />
          <span className={styles.retentionUnit}>days</span>
        </div>
      </div>

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
                  {formatCountdown(chat.deleted_at, retentionDays, nowValue)}
                </span>
                {!trashSelectMode && (
                  <div className={styles.trashItemActions}>
                    <button
                      className={styles.trashActionBtn}
                      title="Restore"
                      onClick={e => { e.stopPropagation(); onRestore([chat.id]); }}
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
  );
}
