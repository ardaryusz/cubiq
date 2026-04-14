import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '../../store';
import type { Message } from '../../types';
import * as ipc from '../../lib/ipc';
import { SendHorizonal, Trash2, Edit2, Archive, AlertCircle, Lock, ChevronDown } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import styles from './ChatArea.module.css';

const LINE_HEIGHT = 24;   // px per line in the textarea
const MAX_LINES   = 12;

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export default function ChatArea() {
  const activeChatId   = useAppStore(state => state.activeChatId);
  const chats          = useAppStore(state => state.chats);
  const presets        = useAppStore(state => state.presets);
  const renameChat     = useAppStore(state => state.renameChat);
  const archiveChat    = useAppStore(state => state.archiveChat);
  const deleteChat     = useAppStore(state => state.deleteChat);
  const refreshChats   = useAppStore(state => state.refreshChats);
  const updateChatPreset = useAppStore(state => state.updateChatPreset);
  const lockChatPreset   = useAppStore(state => state.lockChatPreset);
  const createChatSafe   = useAppStore(state => state.createChatSafe);

  const [messages, setMessages]             = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [sendError, setSendError]           = useState<string | null>(null);
  const [input, setInput]                   = useState('');
  const [isSending, setIsSending]           = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleSrc, setEditTitleSrc]     = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const loadingForChatRef = useRef<number | null>(null);

  const activeChat = chats.find(c => c.id === activeChatId);

  // ── auto-grow textarea ──────────────────────────────────────────────
  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxH = LINE_HEIGHT * MAX_LINES;
    const newH = Math.min(el.scrollHeight, maxH);
    el.style.height = `${newH}px`;
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    autoGrow();
  };

  // Reset textarea height when input is cleared
  useEffect(() => {
    if (!input && textareaRef.current) {
      textareaRef.current.style.height = `${LINE_HEIGHT}px`;
      textareaRef.current.style.overflowY = 'hidden';
    }
  }, [input]);

  // ── load messages ───────────────────────────────────────────────────
  const loadMessages = useCallback(async (chatId: number) => {
    loadingForChatRef.current = chatId;
    setIsLoadingMessages(true);
    setMessages([]);
    setSendError(null);
    try {
      const msgs = await ipc.getMessages(chatId);
      if (loadingForChatRef.current === chatId) setMessages(msgs);
    } catch (e) {
      if (loadingForChatRef.current === chatId) setSendError(`Failed to load messages: ${String(e)}`);
    } finally {
      if (loadingForChatRef.current === chatId) setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (activeChatId !== null && activeChatId !== undefined) {
      loadMessages(activeChatId);
    } else {
      loadingForChatRef.current = null;
      setMessages([]);
      setSendError(null);
      setIsLoadingMessages(false);
    }
    setInput('');
    setIsEditingTitle(false);
  }, [activeChatId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── core send logic (takes an explicit chatId) ──────────────────────
  const doSend = async (chatId: number, content: string) => {
    setSendError(null);
    setIsSending(true);
    loadingForChatRef.current = chatId;

    try {
      const chat = chats.find(c => c.id === chatId);
      if (chat && !chat.preset_locked) {
        await lockChatPreset(chatId);
      }

      await ipc.addMessage(chatId, 'user', content);
      const msgsAfterUser = await ipc.getMessages(chatId);
      if (loadingForChatRef.current === chatId) setMessages(msgsAfterUser);

      await ipc.sendChatMessage(chatId);
      const msgsAfterAi = await ipc.getMessages(chatId);
      if (loadingForChatRef.current === chatId) setMessages(msgsAfterAi);

      await refreshChats();
    } catch (e) {
      setSendError(`${String(e)}`);
      try {
        const msgs = await ipc.getMessages(chatId);
        if (loadingForChatRef.current === chatId) setMessages(msgs);
      } catch (_) {}
    } finally {
      setIsSending(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

  // ── handleSend: works from empty-state too ──────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const content = input.trim();
    setInput('');

    if (activeChatId !== null && activeChatId !== undefined) {
      doSend(activeChatId, content);
    } else {
      // Empty state: create a chat then send
      const newId = await createChatSafe();
      if (newId) {
        doSend(newId, content);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const saveTitle = () => {
    if (editTitleSrc.trim()) renameChat(activeChatId!, editTitleSrc.trim());
    setIsEditingTitle(false);
  };

  // ── Preset selector (shown in composer area) ─────────────────────────
  const renderPresetSelector = () => {
    if (!activeChat) return null;
    if (activeChat.preset_locked) {
      return (
        <span className={styles.presetLockedComposer} title="Preset locked for this chat">
          <Lock size={11} /> {activeChat.preset_name_snapshot || 'Default'}
        </span>
      );
    }
    return (
      <div className={styles.presetSelectorComposer}>
        <select
          className={styles.presetSelectComposer}
          value={activeChat.preset_id ?? ''}
          onChange={async e => {
            const presetId = Number(e.target.value);
            if (presetId && activeChatId) await updateChatPreset(activeChatId, presetId);
          }}
          title="Select preset (locks after first message)"
        >
          {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <ChevronDown size={11} className={styles.presetSelectIconComposer} />
      </div>
    );
  };

  // ── Shared composer ──────────────────────────────────────────────────
  const renderComposer = () => (
    <div className={styles.composer}>
      <div className={styles.composerInner}>
        <textarea
          ref={textareaRef}
          className={styles.composerInput}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your message…"
          rows={1}
          disabled={isSending}
        />
        <div className={styles.composerFooter}>
          <div className={styles.composerLeft}>
            {renderPresetSelector()}
          </div>
          <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim() || isSending}>
            <SendHorizonal size={20} />
          </button>
        </div>
      </div>
    </div>
  );

  // ── Empty state (no active chat) ─────────────────────────────────────
  if (!activeChatId || !activeChat) {
    return (
      <div className={styles.chatAreaEmpty}>
        <div className={styles.emptyStateContent}>
          <h2>Welcome to Cubiq</h2>
          <p>Send a message below to start a new conversation.</p>
        </div>
        {renderComposer()}
      </div>
    );
  }

  // ── Active chat ──────────────────────────────────────────────────────
  return (
    <div className={styles.chatArea}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.title}>
            {isEditingTitle ? (
              <input
                autoFocus
                value={editTitleSrc}
                onChange={e => setEditTitleSrc(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={e => e.key === 'Enter' && saveTitle()}
                style={{ background: 'transparent', border: '1px solid var(--border-medium)', outline: 'none', color: 'inherit', padding: '2px 5px', borderRadius: '4px' }}
              />
            ) : (
              <span>{activeChat.title}</span>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.iconBtn} title="Rename chat"
            onClick={() => { setEditTitleSrc(activeChat.title); setIsEditingTitle(true); }}>
            <Edit2 size={16} />
          </button>
          <button className={styles.iconBtn} title={activeChat.archived ? 'Unarchive chat' : 'Archive chat'}
            onClick={() => archiveChat(activeChatId, !activeChat.archived)}>
            <Archive size={16} />
          </button>
          <button className={styles.iconBtn} title="Delete chat"
            onClick={() => deleteChat(activeChatId)}>
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
          <div className={styles.emptyState}><p>Loading messages…</p></div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}><p>No messages yet. Send a message to start!</p></div>
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

      {renderComposer()}
    </div>
  );
}
