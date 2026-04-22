import { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { getFolderChatPreviews } from '../../lib/ipc';
import type { FolderChatPreview } from '../../types';
import { Search, FolderOpen, SendHorizonal } from 'lucide-react';
import styles from './FolderView.module.css';
import * as ipc from '../../lib/ipc';

export default function FolderView({ folderId }: { folderId: number }) {
  const folders = useAppStore(s => s.folders);
  const setActiveChat = useAppStore(s => s.setActiveChat);
  const setActiveFolder = useAppStore(s => s.setActiveFolder);
  const startChatWithFirstPrompt = useAppStore(s => s.startChatWithFirstPrompt);

  const [previews, setPreviews] = useState<FolderChatPreview[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [prompt, setPrompt] = useState('');

  const folder = folders.find(f => f.id === folderId);

  useEffect(() => {
    getFolderChatPreviews(folderId).then(setPreviews).catch(console.error);
  }, [folderId]);

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
    await startChatWithFirstPrompt(folderId, content);
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
          <input
            className={styles.composerInput}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={`Start a chat in ${folder.name}…`}
            autoFocus
          />
          <button
            type="submit"
            className={styles.sendBtn}
            disabled={!prompt.trim()}
          >
            <SendHorizonal size={18} />
          </button>
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
