import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAppStore } from '../../store';
import type { Message } from '../../types';
import * as ipc from '../../lib/ipc';
import { SendHorizonal, Trash2, Edit2, Archive, AlertCircle, Lock, ChevronDown, Square } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
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

interface StreamDeltaPayload {
  request_id: string;
  delta: string;
}

interface StreamDonePayload {
  request_id: string;
}

interface StreamErrorPayload {
  request_id: string;
  message: string;
}

let _requestCounter = 0;
function nextRequestId() {
  return `chat-${Date.now()}-${++_requestCounter}`;
}

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
  const refreshChats = useAppStore(state => state.refreshChats);
  const updateChatPreset = useAppStore(state => state.updateChatPreset);
  const lockChatPreset = useAppStore(state => state.lockChatPreset);
  const startNewChat = useAppStore(state => state.startNewChat);

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleSrc, setEditTitleSrc] = useState('');

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef        = useRef<HTMLTextAreaElement>(null);
  const loadingForChatRef  = useRef<number | null>(null);
  const activeRequestRef   = useRef<string | null>(null);
  const accumulatorRef     = useRef('');
  const streamChatIdRef    = useRef<number | null>(null);
  const isStickyRef        = useRef(true);

  // Placeholder message shown during streaming (not in DB).
  // content = raw accumulated text (updated every delta for accumulation)
  const [streamingMessage, setStreamingMessage] = useState<{ content: string; isStreaming: boolean } | null>(null);

  // Throttled render text — drives the markdown renderer during streaming.
  // We update it using requestAnimationFrame so it streams at 60fps smoothly
  // instead of clumping into paragraphs.
  const [renderText, setRenderText] = useState('');
  const needsRenderRef = useRef(false);
  const renderRafRef = useRef<number | null>(null);

  // Helper to check if markdown contains an unclosed code fence
  const hasUnclosedFence = (text: string) => {
    const fences = text.match(/```/g);
    return fences ? fences.length % 2 !== 0 : false;
  };

  const activeChat = chats.find(c => c.id === activeChatId);

  const emptyGreeting = useMemo(() => {
    return EMPTY_GREETINGS[Math.floor(Math.random() * EMPTY_GREETINGS.length)];
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
    if (activeRequestRef.current) {
      ipc.cancelStream(activeRequestRef.current).catch(() => { });
      activeRequestRef.current = null;
    }
    setIsStreaming(false);
    setStreamingMessage(null);
    accumulatorRef.current = '';
    streamChatIdRef.current = null;
  }, []);

  // ── stream event listeners ──────────────────────────────────
  // Uses global listen() — backend uses app_handle.emit() (global broadcast).
  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    const setup = async () => {
      const unDelta = await listen<StreamDeltaPayload>('cubiq:stream_delta', ({ payload }) => {
        if (payload.request_id !== activeRequestRef.current) return;
        accumulatorRef.current += payload.delta;

        // RAF-throttled render + autoscroll (max ~60fps)
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
      });

      const unDone = await listen<StreamDonePayload>('cubiq:stream_done', async ({ payload }) => {
        if (payload.request_id !== activeRequestRef.current) return;
        const full = accumulatorRef.current;
        const chatId = streamChatIdRef.current;
        const requestId = activeRequestRef.current;

        // Flush any pending render and do a final render
        if (renderRafRef.current) {
          cancelAnimationFrame(renderRafRef.current);
          renderRafRef.current = null;
        }
        needsRenderRef.current = false;
        setRenderText(full);
        setStreamingMessage({ content: full, isStreaming: false });
        activeRequestRef.current = null;
        setIsStreaming(false);

        if (chatId && requestId && full.trim()) {
          try {
            await ipc.finalizeChatStream(chatId, requestId, full);
            await refreshChats();
            if (loadingForChatRef.current === chatId) {
              const msgs = await ipc.getMessages(chatId);
              setMessages(msgs);
              setStreamingMessage(null);
              setRenderText('');
            }
          } catch (e) {
            setSendError(`Failed to save response: ${String(e)}`);
          }
        } else {
          setStreamingMessage(null);
          setRenderText('');
        }

        accumulatorRef.current = '';
        streamChatIdRef.current = null;
        setTimeout(() => textareaRef.current?.focus(), 0);
      });

      const unError = await listen<StreamErrorPayload>('cubiq:stream_error', ({ payload }) => {
        if (payload.request_id !== activeRequestRef.current) return;
        if (renderRafRef.current) { cancelAnimationFrame(renderRafRef.current); renderRafRef.current = null; }
        needsRenderRef.current = false;
        setSendError(payload.message);
        activeRequestRef.current = null;
        accumulatorRef.current = '';
        streamChatIdRef.current = null;
        setIsStreaming(false);
        setStreamingMessage(null);
        setRenderText('');
        setTimeout(() => textareaRef.current?.focus(), 0);
      });

      if (cancelled) {
        unDelta(); unDone(); unError();
      } else {
        unlistens.push(unDelta, unDone, unError);
      }
    };

    setup().catch(console.error);

    return () => {
      cancelled = true;
      unlistens.forEach(fn => fn());
    };
  }, [refreshChats]);

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
      // Cancel any active stream when switching chats
      cancelActiveStream();
      loadMessages(activeChatId);
    } else {
      loadingForChatRef.current = null;
      cancelActiveStream();
      setMessages([]);
      setSendError(null);
      setIsLoadingMessages(false);
    }
    setInput('');
    setIsEditingTitle(false);
  }, [activeChatId, loadMessages, cancelActiveStream]);

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
  const doSend = async (chatId: number, content: string) => {
    setSendError(null);
    setIsStreaming(true);
    loadingForChatRef.current = chatId;

    try {
      // 1. Snapshot the preset if not locked
      const chat = chats.find(c => c.id === chatId);
      if (chat && !chat.preset_locked) {
        await lockChatPreset(chatId);
      }

      // 2. Add user message
      await ipc.addMessage(chatId, 'user', content);

      // Update local state if we are still on this chat
      if (loadingForChatRef.current === chatId) {
        const msgs = await ipc.getMessages(chatId);
        setMessages(msgs);
      }

      // 3. Start streaming
      const requestId = nextRequestId();
      activeRequestRef.current = requestId;
      accumulatorRef.current = '';
      streamChatIdRef.current = chatId;

      isStickyRef.current = true;
      setStreamingMessage({ content: '', isStreaming: true });
      setRenderText('');

      // Force scroll to bottom on send
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });

      await ipc.startChatStream(chatId, requestId);
    } catch (e) {
      setSendError(`${String(e)}`);
      setIsStreaming(false);
      setStreamingMessage(null);
      activeRequestRef.current = null;
      streamChatIdRef.current = null;
      if (loadingForChatRef.current === chatId) {
        try {
          const msgs = await ipc.getMessages(chatId);
          setMessages(msgs);
        } catch (_) { }
      }
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  };

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
    // If draft chat
    if (!activeChatId || !activeChat) {
      return (
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
      );
    }

    // If active chat
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
          <button onClick={() => setSendError(null)} className={styles.errorDismiss}>×</button>
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
