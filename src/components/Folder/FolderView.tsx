import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { getFolderChatPreviews } from '../../lib/ipc';
import type { FolderChatPreview } from '../../types';
import { Search, FolderOpen, SendHorizonal, ChevronDown } from 'lucide-react';
import styles from './FolderView.module.css';

export default function FolderView({ folderId }: { folderId: number }) {
  const folders = useAppStore(s => s.folders);
  const setActiveChat = useAppStore(s => s.setActiveChat);
  const setActiveFolder = useAppStore(s => s.setActiveFolder);
  const startChatWithFirstPrompt = useAppStore(s => s.startChatWithFirstPrompt);

  const chats = useAppStore(s => s.chats);
  const presets = useAppStore(s => s.presets);
  const draftPresetId = useAppStore(s => s.draftPresetId);

  const [previews, setPreviews] = useState<FolderChatPreview[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [prompt, setPrompt] = useState('');

  const folder = folders.find(f => f.id === folderId);

  // Auto-refresh previews whenever the global chat list changes (e.g. rename, delete, new)
  useEffect(() => {
    getFolderChatPreviews(folderId).then(setPreviews).catch(console.error);
  }, [folderId, chats]);

  // Esc returns to empty state
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveFolder(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setActiveFolder]);

  const handleStartChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = prompt.trim();
    if (!content) return;

    // Delegate creation, navigation, and streaming to the global store
    await startChatWithFirstPrompt(folderId, content, draftPresetId);
  };

  const filteredChats = previews.filter(c => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return c.title.toLowerCase().includes(query) || (c.preview_text && c.preview_text.toLowerCase().includes(query));
  });

  if (!folder) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <FolderOpen size={32} className={styles.headerIcon} />
        <h1 className={styles.headerTitle}>{folder.name}</h1>
      </div>

      <div className={styles.composerContainer}>
        <form className={styles.composer} onSubmit={handleStartChat}>
          <div className={styles.composerInner}>
            <input
              className={styles.composerInput}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`Start a chat in ${folder.name}…`}
              autoFocus
            />
            <div className={styles.composerFooter}>
              <div className={styles.composerLeft}>
                <div className={styles.presetSelectorComposer}>
                  <select
                    className={styles.presetSelectComposer}
                    value={draftPresetId ?? ''}
                    onChange={e => {
                      const pid = Number(e.target.value);
                      useAppStore.setState({ draftPresetId: pid });
                    }}
                    title="Select preset for new chat"
                  >
                    {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <ChevronDown size={11} className={styles.presetSelectIconComposer} />
                </div>
              </div>
              <button
                type="submit"
                className={styles.sendBtn}
                disabled={!prompt.trim()}
              >
                <SendHorizonal size={20} />
              </button>
            </div>
          </div>
        </form>
      </div>

      <div className={styles.mainContent}>
        <div className={styles.toolbar}>
          <h2 className={styles.sectionTitle}>Folder Chats</h2>
          <div className={styles.searchControl}>
            <Search size={14} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats…"
            />
          </div>
        </div>

        <div className={styles.chatList}>
          {filteredChats.length === 0 ? (
            <div className={styles.emptyState}>
              {searchQuery ? "No matches found" : "No chats in this folder yet"}
            </div>
          ) : (
            filteredChats.map(c => (
              <div
                key={c.id}
                className={styles.chatRow}
                onClick={() => setActiveChat(c.id)}
              >
                <div className={styles.chatTitle}>{c.title}</div>
                <div className={styles.chatPreview}>
                  {c.preview_text || '(No messages yet)'}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
