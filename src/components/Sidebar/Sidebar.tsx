import { useAppStore } from '../../store';
import { Plus, Archive, Settings as SettingsIcon } from 'lucide-react';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const chats = useAppStore(state => state.chats);
  const activeChatId = useAppStore(state => state.activeChatId);
  const showArchived = useAppStore(state => state.showArchived);
  
  const createChat = useAppStore(state => state.createChat);
  const setActiveChat = useAppStore(state => state.setActiveChat);
  const setShowArchived = useAppStore(state => state.setShowArchived);
  const setSettingsOpen = useAppStore(state => state.setSettingsOpen);

  const handleNewChat = () => {
    createChat("New Chat");
  };

  const visibleChats = chats.filter(c => c.archived === showArchived);

  return (
    <div className={styles.sidebar}>
      <button className={styles.newChatBtn} onClick={handleNewChat}>
        <Plus size={18} />
        New chat
      </button>

      <div className={styles.chatList}>
        {visibleChats.length === 0 && (
          <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No {showArchived ? 'archived' : 'active'} chats
          </div>
        )}
        {visibleChats.map((chat, i) => (
          <button
            key={chat.id ?? i}
            className={`${styles.chatItem} ${chat.id === activeChatId ? styles.chatItemActive : ''}`}
            onClick={() => setActiveChat(chat.id ?? null)}
          >
            {chat.title}
          </button>
        ))}
      </div>

      <div className={styles.bottomActions}>
        <button 
          className={styles.actionBtn}
          onClick={() => {
            setShowArchived(!showArchived);
            setActiveChat(null);
          }}
        >
          <Archive size={18} />
          {showArchived ? 'Active chats' : 'Archived chats'}
        </button>
        <button 
          className={styles.actionBtn}
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={18} />
          Settings
        </button>
      </div>
    </div>
  );
}
