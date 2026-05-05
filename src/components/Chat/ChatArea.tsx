import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useAppStore } from '../../store';
import { SendHorizonal, Trash2, Edit2, Archive, AlertCircle, Lock, Square } from 'lucide-react';
import { hasUnclosedFence } from '../../utils/markdown';
import MarkdownRenderer from './MarkdownRenderer';
import DraftPresetSelector from '../shared/DraftPresetSelector';
import styles from './ChatArea.module.css';

const LINE_HEIGHT = 24;   // px per line in the textarea
const MAX_LINES = 12;

const EMPTY_GREETINGS = [
  "Ready when you are.",
  "What are we building today?",
  "Ask anything.",
  "Let’s make something useful.",
  "What’s the problem to solve?",
  "Got a question?",
  "Start with anything.",
  "What’s on your mind?",
  "Need a second brain?",
  "Let’s figure it out.",
  "Throw me a task.",
  "What are we tackling today?",
  "Let’s get to work.",
  "Tell me what you need.",
  "Start a new idea.",
  "Need help with something?",
  "Ask me anything.",
  "What are we solving today?",
  "Let’s start with a question.",
  "Ready for the first prompt?"
];

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
  const draftPresetId = useAppStore(state => state.draftPresetId);
  const chats = useAppStore(state => state.chats);
  const presets = useAppStore(state => state.presets);
  const renameChat = useAppStore(state => state.renameChat);
  const archiveChat = useAppStore(state => state.archiveChat);
  const deleteChat = useAppStore(state => state.deleteChat);
  const startNewChat = useAppStore(state => state.startNewChat);

  const [input, setInput] = useState('');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleSrc, setEditTitleSrc] = useState('');

  const allMessages = useAppStore(state => state.messages);
  const streamingMessages = useAppStore(state => state.streamingMessages);
  const loadMessages = useAppStore(state => state.loadMessages);
  const sendChatMessage = useAppStore(state => state.sendChatMessage);
  const clearSendError = useAppStore(state => state.clearSendError);
  const setDraftPresetId = useAppStore(state => state.setDraftPresetId);

  const messages = useMemo(
    () => (activeChatId ? (allMessages[activeChatId] ?? []) : []),
    [activeChatId, allMessages],
  );
  const streamState = activeChatId ? streamingMessages[activeChatId] : null;
  const isStreaming = streamState?.isStreaming ?? false;
  const streamingMessage = streamState ? { content: streamState.content, isStreaming: streamState.isStreaming } : null;
  const sendError = streamState?.sendError || null;
  const isLoadingMessages = activeChatId ? !allMessages[activeChatId] : false;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef        = useRef<HTMLTextAreaElement>(null);
  const loadingForChatRef  = useRef<number | null>(null);
  const accumulatorRef     = useRef('');
  const streamChatIdRef    = useRef<number | null>(null);
  const isStickyRef        = useRef(true);

  const [renderText, setRenderText] = useState('');
  const needsRenderRef = useRef(false);
  const renderRafRef = useRef<number | null>(null);

  const activeChat = chats.find(c => c.id === activeChatId);

  // Deterministic greeting: pick by hashing activeChatId so it is stable
  // across re-renders of the same chat but changes when the chat changes.
  // No Math.random during render — purely derived from the chat id.
  const emptyGreeting = useMemo(() => {
    const key = activeChatId ?? 0;
    // Simple numeric hash: multiply by a prime, then mod by list length
    const index = Math.abs((key * 2654435761) >>> 0) % EMPTY_GREETINGS.length;
    return EMPTY_GREETINGS[index];
  }, [activeChatId]);

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

  // ── cancel helper ───────────────────────────────────────────────────
  const cancelActiveStream = useCallback(() => {
    // We don't track request_id locally anymore, backend/store could track it if we needed proper cancellation.
    // But for now, we just clear our refs.
    accumulatorRef.current = '';
    streamChatIdRef.current = null;
  }, []);

  // Destructure only the specific fields we depend on so the effect deps are
  // stable primitives — avoids a stale-closure warning while preventing
  // unnecessary re-runs caused by a new object reference each render.
  const streamContent = streamState?.content;
  const streamIsStreaming = streamState?.isStreaming;

  // Sync global streaming content to local RAF-throttled render
  useEffect(() => {
    if (streamIsStreaming) {
      accumulatorRef.current = streamContent ?? '';
      needsRenderRef.current = true;
      if (!renderRafRef.current) {
        renderRafRef.current = requestAnimationFrame(() => {
          renderRafRef.current = null;
          if (needsRenderRef.current) {
            setRenderText(accumulatorRef.current);
            needsRenderRef.current = false;
          }
          if (isStickyRef.current) {
            const el = scrollContainerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }
        });
      }
    } else if (streamIsStreaming === false && streamContent !== undefined) {
      // Final flush
      if (renderRafRef.current) {
        cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
      // Defer the state update so it runs outside the synchronous effect body,
      // avoiding the react-hooks/set-state-in-effect cascade warning.
      const finalContent = streamContent;
      setTimeout(() => {
        setRenderText(finalContent);
        textareaRef.current?.focus();
      }, 0);
    } else {
      // Also defer the clear so it matches the deferred set above.
      setTimeout(() => setRenderText(''), 0);
    }
  }, [streamContent, streamIsStreaming]);



  useEffect(() => {
    if (activeChatId !== null && activeChatId !== undefined) {
      loadMessages(activeChatId);
    } else {
      loadingForChatRef.current = null;
    }
    // Defer these two state updates so they don't fire synchronously inside
    // the effect body (react-hooks/set-state-in-effect).
    setTimeout(() => {
      setInput('');
      setIsEditingTitle(false);
    }, 0);
  }, [activeChatId, loadMessages]);

  // ── scroll: snap to bottom instantly when messages load ────────────
  useLayoutEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ── scroll: track stickiness via scroll events ────────────────────────
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      isStickyRef.current = dist < 150;
    };

    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ── core send logic (takes an explicit chatId) ──────────────────────
  const doSend = useCallback(async (chatId: number, content: string) => {
    isStickyRef.current = true;
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    await sendChatMessage(chatId, content);
  }, [sendChatMessage]);



  // ── handleSend: works from empty-state too ──────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const content = input.trim();
    setInput('');

    if (activeChatId !== null && activeChatId !== undefined) {
      doSend(activeChatId, content);
    } else {
      // Lazy Create: This is a draft chat.
      await startNewChat();
      const newId = useAppStore.getState().activeChatId;
      if (newId) {
        doSend(newId, content);
      }
    }
  };

  const handleStop = () => {
    cancelActiveStream();
    // If there was partial content, we DON'T persist it (MVP behavior)
    setTimeout(() => textareaRef.current?.focus(), 0);
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
    // Draft chat (no activeChatId) — show editable preset picker
    if (!activeChatId || !activeChat) {
      return (
        <DraftPresetSelector
          presets={presets}
          value={draftPresetId}
          onChange={setDraftPresetId}
          className={styles.presetSelectorComposer}
          selectClassName={styles.presetSelectComposer}
          iconClassName={styles.presetSelectIconComposer}
        />
      );
    }

    // Existing chat — always locked, show read-only label
    const lockedName = activeChat.preset_name_snapshot || 'Default';
    return (
      <span
        className={styles.presetLockedComposer}
        title="Preset is locked for existing chats."
      >
        <Lock size={11} /> {lockedName}
      </span>
    );
  };

  // ── Shared composer ──────────────────────────────────────────────────
  const renderComposer = (isCentered?: boolean) => (
    <div className={`${styles.composer} ${isCentered ? styles.centeredComposer : ''}`}>
      <div className={styles.composerInner}>
        <textarea
          ref={textareaRef}
          className={styles.composerInput}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Type your message…"
          rows={1}
          disabled={isStreaming}
        />
        <div className={styles.composerFooter}>
          <div className={styles.composerLeft}>
            {renderPresetSelector()}
          </div>
          {isStreaming ? (
            <button className={`${styles.sendBtn} ${styles.stopBtn}`} onClick={handleStop} title="Stop generation">
              <Square size={16} />
            </button>
          ) : (
            <button className={styles.sendBtn} onClick={handleSend} disabled={!input.trim()}>
              <SendHorizonal size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const isEmptyChat = messages.length === 0 && !streamingMessage;

  // ── Empty state (no active chat) ─────────────────────────────────────
  if (!activeChatId || !activeChat) {
    return (
      <div className={styles.chatAreaEmpty}>
        <div className={styles.emptyCenteredGroup}>
          <h2 className={styles.greetingText}>{emptyGreeting}</h2>
          {renderComposer(true)}
        </div>
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
          <button onClick={() => activeChatId && clearSendError(activeChatId)} className={styles.errorDismiss}>×</button>
        </div>
      )}

      <div className={styles.messages} ref={scrollContainerRef}>
        {isLoadingMessages ? (
          <div className={styles.emptyState}><p>Loading messages…</p></div>
        ) : isEmptyChat ? (
          <div className={styles.emptyCenteredGroup}>
            <h2 className={styles.greetingText}>{emptyGreeting}</h2>
            {renderComposer(true)}
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
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
            ))}

            {/* Streaming assistant placeholder */}
            {streamingMessage && (
              <div className={`${styles.messageRow} ${styles.assistant}`}>
                <div className={`${styles.messageContent} ${styles.assistantContent}`}>
                  <div className={`${styles.avatar} ${styles.assistant}`}>AI</div>
                  <div className={styles.messageText}>
                    {streamingMessage.isStreaming ? (
                      <div className={`${styles.streamingContent} ${styles.streamingAnchorNone}`}>
                        {renderText ? (
                          <>
                            {/* Progressive markdown: renders throttled renderText so
                                the markdown parser doesn't run every single token */}
                            {hasUnclosedFence(renderText) ? (
                              <pre style={{
                                margin: 0,
                                fontFamily: 'var(--font-mono, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace)',
                                fontSize: '0.82rem',
                                overflowX: 'auto',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--bg-composer)',
                                padding: '8px',
                                border: '1px solid var(--border-medium)',
                                whiteSpace: 'pre-wrap'
                              }}>
                                {renderText}
                              </pre>
                            ) : (
                              <MarkdownRenderer content={renderText} />
                            )}
                            <span className={styles.streamCursor} />
                          </>
                        ) : (
                          <div className={styles.thinking}>
                            <span className={styles.dot} />
                            <span className={styles.dot} />
                            <span className={styles.dot} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <MarkdownRenderer content={streamingMessage.content} />
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

      </div>

      {!isEmptyChat && !isLoadingMessages && renderComposer()}
    </div>
  );
}
