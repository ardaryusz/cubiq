import { useEffect, useState, useRef, useCallback } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Pin, Trash2, ExternalLink, X, Square } from 'lucide-react';
import MarkdownRenderer from './components/Chat/MarkdownRenderer';
import * as ipc from './lib/ipc';
import styles from './QuickAskApp.module.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

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

// ── helpers ────────────────────────────────────────────────────────────────────

let _requestCounter = 0;
function nextRequestId() {
  return `qa-${Date.now()}-${++_requestCounter}`;
}

function applyTheme(appTheme: string) {
  const root = document.documentElement;
  root.className = root.className
    .split(' ')
    .filter(c => !c.startsWith('theme-'))
    .concat(`theme-${appTheme}`)
    .join(' ')
    .trim();
}

async function syncTheme() {
  try {
    const settings = await invoke<{ app_theme: string }>('get_settings');
    if (settings?.app_theme) {
      applyTheme(settings.app_theme);
      invoke('sync_quickask_theme', { appTheme: settings.app_theme }).catch(() => { });
    }
  } catch (err) {
    console.warn('[Cubiquick] theme sync failed:', err);
  }
}

// ── component ──────────────────────────────────────────────────────────────────

export default function QuickAskApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isPinnedRef = useRef(isPinned);
  const activeRequestRef = useRef<string | null>(null);
  const accumulatorRef = useRef('');
  // Track registered unlisten functions so we can clean up properly
  const unlistenFnsRef = useRef<UnlistenFn[]>([]);

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

  // Keep isPinnedRef in sync
  useEffect(() => { isPinnedRef.current = isPinned; }, [isPinned]);

  // ── cancel helper ─────────────────────────────────────────────────────────
  const cancelActiveStream = useCallback(() => {
    const rid = activeRequestRef.current;
    if (rid) {
      ipc.cancelStream(rid).catch(() => { });
      activeRequestRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  // ── UI-only clear (messages/input/error, no stream cancel) ─────────────────
  const clearUIState = useCallback(() => {
    setMessages([]);
    setInput('');
    setError(null);
    accumulatorRef.current = '';
  }, []);

  // ── full clear: cancel stream + reset UI ───────────────────────────────────
  const clearAll = useCallback(() => {
    cancelActiveStream();
    clearUIState();
  }, [cancelActiveStream, clearUIState]);

  const dismissWindow = useCallback(() => {
    clearAll();
    getCurrentWebviewWindow().hide();
  }, [clearAll]);

  const handleOpenMain = useCallback(async () => {
    await invoke('open_main_window');
    dismissWindow();
  }, [dismissWindow]);

  // ── sync pinned state to Rust ──────────────────────────────────────────────
  useEffect(() => {
    invoke('set_quickask_pinned', { pinned: isPinned }).catch(() => { });
  }, [isPinned]);

  // ── EFFECT 1: window / keyboard / theme listeners ─────────────────────────
  // These may re-register when deps change (that's OK, they don't carry stream state).
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    syncTheme();

    const unlistenShown = win.listen('quickask-shown', () => syncTheme());
    const onWindowBlur = () => {
      setTimeout(() => {
        if (!isPinnedRef.current) {
          win.hide();
        }
      }, 0);
    };
    window.addEventListener('blur', onWindowBlur);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissWindow();
        return;
      }

      // Window-scoped shortcuts — only active when Cubiquick is focused
      if (e.ctrlKey && e.altKey) {
        switch (e.key.toUpperCase()) {
          case 'P':
            // Ctrl+Alt+P → pin / unpin
            console.log('[Cubiquick] Ctrl+Alt+P → toggle pin');
            e.preventDefault();
            setIsPinned(p => !p);
            break;
          case 'D':
            // Ctrl+Alt+D → clear chat (stay open)
            console.log('[Cubiquick] Ctrl+Alt+D → clear chat');
            e.preventDefault();
            cancelActiveStream();
            clearUIState();
            break;
          case 'C':
            // Ctrl+Alt+C → open main app (and hide quickask unless pinned)
            console.log('[Cubiquick] Ctrl+Alt+C → open main window');
            e.preventDefault();
            handleOpenMain();
            break;
          default:
            break;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
      unlistenShown.then(f => f());
    };
  }, [clearAll, dismissWindow, cancelActiveStream, clearUIState, handleOpenMain]);

  // ── EFFECT 2: streaming event listeners — mount ONCE, stay alive ───────────
  // Uses the GLOBAL listen() from @tauri-apps/api/event.
  // Why: backend uses app_handle.emit_to(label) → EventTarget::AnyLabel.
  // win.listen() filters for EventTarget::WebviewWindow — a different variant
  // in Tauri v2's event system, causing events to be silently dropped.
  // The global listen() in this webview receives AnyLabel-targeted events correctly.
  useEffect(() => {
    let cancelled = false;
    const unlistens: UnlistenFn[] = [];

    const setup = async () => {
      console.log('[QA] registering stream listeners via global listen()');
      try {
        const unTheme = await listen<{ app_theme: string }>('cubiq:theme_changed', ({ payload }) => {
          if (payload?.app_theme) applyTheme(payload.app_theme);
        });
        
        const unDelta = await listen<StreamDeltaPayload>('cubiq:stream_delta', ({ payload }) => {
          console.log('[QA delta]', payload.request_id, 'active=', activeRequestRef.current,
            'match=', payload.request_id === activeRequestRef.current,
            'preview=', payload.delta.slice(0, 20));
          if (payload.request_id !== activeRequestRef.current) return;

          accumulatorRef.current += payload.delta;
          const full = accumulatorRef.current;

          // High-framerate markdown render and stream-following scroll (max ~60fps)
          needsRenderRef.current = true;
          if (!renderRafRef.current) {
            renderRafRef.current = requestAnimationFrame(() => {
              renderRafRef.current = null;
              if (needsRenderRef.current) {
                setRenderText(full);
                needsRenderRef.current = false;
              }
              // QuickAsk scrolls to bottom continuously during streaming
              messagesEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
            });
          }
        });

        const unDone = await listen<StreamDonePayload>('cubiq:stream_done', ({ payload }) => {
          console.log('[QA done]', payload.request_id, 'active=', activeRequestRef.current);
          if (payload.request_id !== activeRequestRef.current) return;

          const full = accumulatorRef.current;

          // Flush any pending render and do a final render
          if (renderRafRef.current) {
            cancelAnimationFrame(renderRafRef.current);
            renderRafRef.current = null;
          }
          needsRenderRef.current = false;
          setRenderText(full);

          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: full, isStreaming: false };
            }
            return updated;
          });
          activeRequestRef.current = null;
          accumulatorRef.current = '';
          setIsStreaming(false);
          // Don't clear renderText immediately so the bubble doesn't flicker
          // It will be cleared on handleSend
        });

        const unError = await listen<StreamErrorPayload>('cubiq:stream_error', ({ payload }) => {
          console.error('[QA error]', payload.request_id, 'active=', activeRequestRef.current, payload.message);
          if (payload.request_id !== activeRequestRef.current) return;

          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant' && last.isStreaming) updated.pop();
            return updated;
          });

          if (renderRafRef.current) {
            cancelAnimationFrame(renderRafRef.current);
            renderRafRef.current = null;
          }
          needsRenderRef.current = false;

          const msg = payload.message;
          setError(msg.includes('API key is not set') ? 'missing_key' : msg);
          activeRequestRef.current = null;
          accumulatorRef.current = '';
          setIsStreaming(false);
          setRenderText('');
        });

        if (cancelled) {
          // Effect cleanup ran before setup finished (React Strict Mode double-invoke)
          unTheme(); unDelta(); unDone(); unError();
          console.log('[QA] listeners cancelled before setup completed, cleaned up');
        } else {
          unlistens.push(unTheme, unDelta, unDone, unError);
          unlistenFnsRef.current = unlistens;
          console.log('[QA] stream listeners registered OK');
        }
      } catch (err) {
        console.error('[QA] Failed to register stream listeners:', err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      // Immediately unregister any already-registered listeners
      unlistens.forEach(fn => fn());
      unlistenFnsRef.current = [];
      console.log('[QA] stream listeners cleanup');
    };
  }, []); // ← empty deps: register once for the entire lifetime of the component

  // ── auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isStreaming) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  // ── send message ───────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: input.trim() },
    ];

    const requestId = nextRequestId();
    // Set request ID ref FIRST — before any await — so the listener
    // can match even if the first delta arrives before startEphemeralStream returns
    activeRequestRef.current = requestId;
    accumulatorRef.current = '';

    // Add placeholder AFTER setting the ref (so the listener can find it)
    setMessages([...newMessages, { role: 'assistant', content: '', isStreaming: true }]);
    setInput('');
    setIsStreaming(true);
    setRenderText(''); // Clear previous renderText
    setError(null);

    console.log('[QA send] request_id=', requestId, 'listeners=', unlistenFnsRef.current.length);

    try {
      const history = newMessages.map(m => ({ role: m.role, content: m.content }));
      await ipc.startEphemeralStream(history, requestId);
      console.log('[QA send] startEphemeralStream returned OK for', requestId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
      console.error('[QA send] startEphemeralStream error:', msg);
      setError(msg.includes('API key is not set') ? 'missing_key' : msg);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant' && last.isStreaming) updated.pop();
        return updated;
      });
      activeRequestRef.current = null;
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    cancelActiveStream();
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        if (last.content.trim()) {
          updated[updated.length - 1] = { ...last, isStreaming: false };
        } else {
          updated.pop();
        }
      }
      return updated;
    });
    accumulatorRef.current = '';
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* ── Header / drag region ── */}
      <div data-tauri-drag-region className={styles.header}>
        <div data-tauri-drag-region className={styles.title}>Cubiquick</div>

        <div className={styles.actions}>
          {/* Pin */}
          <button
            className={`${styles.iconButton} ${isPinned ? styles.active : ''}`}
            onClick={() => setIsPinned(p => !p)}
            title={isPinned ? 'Unpin (click-away will close)' : 'Pin (keep open on click-away)'}
            aria-label={isPinned ? 'Unpin window' : 'Pin window'}
          >
            <Pin size={16} fill={isPinned ? "currentColor" : "none"} />
          </button>

          {/* Clear */}
          <button
            className={styles.iconButton}
            onClick={() => { cancelActiveStream(); clearUIState(); }}
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <Trash2 size={16} />
          </button>

          {/* Open full app */}
          <button
            className={styles.iconButton}
            onClick={handleOpenMain}
            title="Open Cubiq"
            aria-label="Open main application"
          >
            <ExternalLink size={16} />
          </button>

          {/* Explicit close */}
          <button
            className={styles.iconButton}
            onClick={() => setShowExitConfirm(true)}
            title="Exit Cubiq"
            aria-label="Exit application"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Exit Confirmation Modal ── */}
      {showExitConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalBox}>
            <div className={styles.modalTitle}>Exit Cubiq?</div>
            <div className={styles.modalContent}>
              This will close Cubiquick and the main application entirely.
            </div>
            <div className={styles.modalActions}>
              <button
                className={`${styles.modalButton} ${styles.cancelBtn}`}
                onClick={() => setShowExitConfirm(false)}
              >
                Cancel
              </button>
              <button
                className={`${styles.modalButton} ${styles.exitBtn}`}
                onClick={() => invoke('quit_app')}
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Messages ── */}
      <div className={styles.messagesContainer}>
        {messages.length === 0 && !isStreaming && !error && (
          <div className={styles.emptyState}>How can I help you?</div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`${styles.message} ${msg.role === 'user' ? styles.user : styles.assistant}`}
          >
            {msg.role === 'user' ? (
              msg.content
            ) : msg.isStreaming ? (
              <span className={styles.streamingText}>
                {renderText ? (
                  hasUnclosedFence(renderText) ? (
                    <pre style={{ whiteSpace: 'pre-wrap', fontStyle: 'inherit' }}>{renderText}</pre>
                  ) : (
                    <MarkdownRenderer content={renderText} />
                  )
                ) : (
                  <span className={styles.thinkingInline}>Thinking…</span>
                )}
                <span className={styles.cursor} />
              </span>
            ) : (
              <MarkdownRenderer content={msg.content} />
            )}
          </div>
        ))}

        {error && (
          <div className={styles.errorBanner}>
            {error === 'missing_key' ? (
              <span>
                No API key.{' '}
                <button onClick={handleOpenMain}>Set up Cubiq →</button>
              </span>
            ) : (
              error
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Composer ── */}
      <div className={styles.inputArea}>
        <textarea
          className={styles.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Ask anything… (Enter sends, Shift+Enter newline)"
          rows={1}
          autoFocus
        />
        {isStreaming ? (
          <button
            className={`${styles.sendButton} ${styles.stopButton}`}
            onClick={handleStop}
            title="Stop generation"
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            className={styles.sendButton}
            onClick={handleSend}
            disabled={!input.trim()}
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
