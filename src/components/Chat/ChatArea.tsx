import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '../../store';
import type { Message } from '../../types';
import * as ipc from '../../lib/ipc';
import { SendHorizonal, Trash2, Edit2, Archive, AlertCircle } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import styles from './ChatArea.module.css';

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export default function ChatArea() {
  const activeChatId = useAppStore(state => state.activeChatId);
  const chats = useAppStore(state => state.chats);
  const renameChat = useAppStore(state => state.renameChat);
  const archiveChat = useAppStore(state => state.archiveChat);
  const deleteChat = useAppStore(state => state.deleteChat);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleSrc, setEditTitleSrc] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Track which chat we're loading for, to discard stale results if user
  // switches chats rapidly while a fetch is in-flight.
  const loadingForChatRef = useRef<number | null>(null);

  const activeChat = chats.find(c => c.id === activeChatId);

  const loadMessages = useCallback(async (chatId: number) => {
    // Mark immediately so stale results can be discarded
    loadingForChatRef.current = chatId;
    setIsLoadingMessages(true);
    // Clear immediately so no stale messages from previous chat bleed through
    setMessages([]);
    setSendError(null);
    try {
      const msgs = await ipc.getMessages(chatId);
      // Only apply if this is still the chat we care about
      if (loadingForChatRef.current === chatId) {
        setMessages(msgs);
      }
    } catch (e) {
      if (loadingForChatRef.current === chatId) {
        setSendError(`Failed to load messages: ${String(e)}`);
      }
    } finally {
      if (loadingForChatRef.current === chatId) {
        setIsLoadingMessages(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeChatId !== null && activeChatId !== undefined) {
      loadMessages(activeChatId);
    } else {
      // No active chat — clear everything
      loadingForChatRef.current = null;
      setMessages([]);
      setSendError(null);
      setIsLoadingMessages(false);
    }
    // Reset composer state when switching chats
    setInput('');
    setIsEditingTitle(false);
  }, [activeChatId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!activeChatId || !activeChat) {
    return (
      <div className={styles.emptyState}>
        <h2>Welcome to Cubiq</h2>
        <p>Select a chat or create a new one to begin.</p>
      </div>
    );
  }

  const handleSend = async () => {
    if (!input.trim() || activeChatId === null || isSending) return;
    const content = input.trim();
    const currentChatId = activeChatId;
    setInput('');
    setSendError(null);
    setIsSending(true);

    try {
      // 1. Save the user message to DB
      await ipc.addMessage(currentChatId, 'user', content);

      // 2. Reload so the user message appears immediately with a real id
      const msgsAfterUser = await ipc.getMessages(currentChatId);
      if (loadingForChatRef.current === currentChatId) {
        setMessages(msgsAfterUser);
      }

      // 3. Call the AI backend (it reads the full history, calls Groq, persists the reply)
      await ipc.sendChatMessage(currentChatId);

      // 4. Reload to show the assistant reply
      const msgsAfterAi = await ipc.getMessages(currentChatId);
      if (loadingForChatRef.current === currentChatId) {
        setMessages(msgsAfterAi);
      }
    } catch (e) {
      setSendError(`${String(e)}`);
      // Still reload so any successfully saved messages are visible
      try {
        const msgs = await ipc.getMessages(currentChatId);
        if (loadingForChatRef.current === currentChatId) {
          setMessages(msgs);
        }
      } catch (_) {
        // silently ignore reload failure here
      }
    } finally {
      setIsSending(false);
    }
  };

  const saveTitle = () => {
    if (editTitleSrc.trim()) {
      renameChat(activeChatId, editTitleSrc.trim());
    }
    setIsEditingTitle(false);
  };

  return (
    <div className={styles.chatArea}>
      <header className={styles.header}>
        <div className={styles.title}>
          {isEditingTitle ? (
            <input
              autoFocus
              value={editTitleSrc}
              onChange={e => setEditTitleSrc(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => e.key === 'Enter' && saveTitle()}
              style={{ background: 'transparent', border: '1px solid var(--border-color)', outline: 'none', color: 'inherit', padding: '2px 5px', borderRadius: '4px' }}
            />
          ) : (
            <span>{activeChat.title}</span>
          )}
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            title="Rename chat"
            onClick={() => { setEditTitleSrc(activeChat.title); setIsEditingTitle(true); }}
          >
            <Edit2 size={16} />
          </button>
          <button
            className={styles.iconBtn}
            title={activeChat.archived ? 'Unarchive chat' : 'Archive chat'}
            onClick={() => archiveChat(activeChatId, !activeChat.archived)}
          >
            <Archive size={16} />
          </button>
          <button
            className={styles.iconBtn}
            title="Delete chat"
            onClick={() => deleteChat(activeChatId)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {sendError && (
        <div className={styles.errorBanner}>
          <AlertCircle size={16} />
          <span>{sendError}</span>
          <button onClick={() => setSendError(null)} className={styles.errorDismiss}>×</button>
        </div>
      )}

      <div className={styles.messages}>
        {isLoadingMessages ? (
          <div className={styles.emptyState}>
            <p>Loading messages…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p>No messages yet. Send a message to start!</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={msg.id ?? i} className={`${styles.messageRow} ${msg.role === 'user' ? styles.user : styles.assistant}`}>
              <div className={`${styles.messageContent} ${msg.role === 'user' ? styles.userContent : styles.assistantContent}`}>
                {msg.role !== 'user' && (
                  <div className={`${styles.avatar} ${styles.assistant}`}>AI</div>
                )}
                <div className={msg.role === 'user' ? styles.userBubbleWrap : styles.messageText}>
                  <div className={msg.role === 'user' ? styles.userBubble : undefined}>
                    {msg.role === 'user' ? msg.content : <MarkdownRenderer content={msg.content} />}
                  </div>
                  <span className={styles.timestamp}>{formatTimestamp(msg.created_at)}</span>
                </div>
              </div>
            </div>
          ))
        )}
        {isSending && (
          <div className={`${styles.messageRow} ${styles.assistant}`}>
            <div className={styles.messageContent}>
              <div className={`${styles.avatar} ${styles.assistant}`}>AI</div>
              <div className={styles.thinking}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={styles.composer}>
        <div className={styles.composerInner}>
          <textarea
            className={styles.composerInput}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your message…"
            rows={1}
            disabled={isSending}
          />
          <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim() || isSending}>
            <SendHorizonal size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}
