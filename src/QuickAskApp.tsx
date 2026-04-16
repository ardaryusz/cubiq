import { useEffect, useState, useRef, useCallback } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { Pin, Trash2, ExternalLink, X } from 'lucide-react';
import MarkdownRenderer from './components/Chat/MarkdownRenderer';
import styles from './QuickAskApp.module.css';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// ── helpers ────────────────────────────────────────────────────────────────────

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
      invoke('sync_quickask_theme', { appTheme: settings.app_theme }).catch(() => {});
    }
  } catch (err) {
    console.warn('[Cubiquick] theme sync failed:', err);
  }
}

// ── component ──────────────────────────────────────────────────────────────────

export default function QuickAskApp() {
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState('');
  const [isPinned, setIsPinned]       = useState(false);
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isPinnedRef    = useRef(isPinned);

  // Keep ref in sync so blur/watcher closures always see current pinned state
  useEffect(() => { isPinnedRef.current = isPinned; }, [isPinned]);

  // ── clear + hide helper ────────────────────────────────────────────────────
  const clearState = useCallback(() => {
    setMessages([]);
    setInput('');
    setError(null);
  }, []);

  const dismissWindow = useCallback(() => {
    clearState();
    getCurrentWebviewWindow().hide();
  }, [clearState]);

  // ── sync pinned state to Rust when it changes ──────────────────────────────
  useEffect(() => {
    invoke('set_quickask_pinned', { pinned: isPinned }).catch(() => {});
  }, [isPinned]);

  // ── on mount: setup all event listeners ───────────────────────────────────
  useEffect(() => {
    const win = getCurrentWebviewWindow();

    // Sync theme on first load
    syncTheme();

    // Re-sync theme each time Rust shows the window (tray click or hotkey)
    const unlistenShown = win.listen('quickask-shown', () => {
      syncTheme();
    });

    // Live theme sync: main app emits this whenever the user picks a new theme
    const unlistenThemeChanged = win.listen<{ app_theme: string }>('cubiq:theme_changed', ({ payload }) => {
      if (payload?.app_theme) {
        applyTheme(payload.app_theme);
      }
    });

    // ── MAIN click-away close mechanism ───────────────────────────────────
    // Rust's focus watcher emits "quickask:clear" before hiding the window.
    // We just need to reset React state here — the window is already gone.
    const unlistenClear = win.listen('quickask:clear', () => {
      clearState();
    });

    // ── Fast-path: JS window blur (fires immediately when focus leaves) ───
    // Best-effort on Windows with alwaysOnTop — if it fires we get <16ms
    // latency instead of waiting up to 70ms for the Rust poller.
    const onWindowBlur = () => {
      setTimeout(() => {
        if (!isPinnedRef.current) {
          clearState();
          win.hide();
        }
      }, 0);
    };
    window.addEventListener('blur', onWindowBlur);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissWindow();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
      unlistenShown.then(f => f());
      unlistenClear.then(f => f());
      unlistenThemeChanged.then(f => f());
    };
  }, [clearState, dismissWindow]);

  // ── auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── send message ───────────────────────────────────────────────────────────
  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const newMessages: Message[] = [
      ...messages,
      { role: 'user', content: input.trim() },
    ];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      const response = await invoke<string>('send_ephemeral_message', { messages: newMessages });
      setMessages(prev => [...prev, { role: 'assistant', content: response }]);
    } catch (e: any) {
      const msg = typeof e === 'string' ? e : e?.message ?? String(e);
      setError(msg.includes('API key is not set') ? 'missing_key' : msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleOpenMain = async () => {
    await invoke('open_main_window');
    dismissWindow();
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* ── Header / drag region ── */}
      <div data-tauri-drag-region className={styles.header}>
        <div data-tauri-drag-region className={styles.title}>Cubiquick</div>

        <div className={styles.actions}>
          {/* Pin – suppresses click-away auto-close */}
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
            onClick={() => { setMessages([]); setError(null); }}
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

          {/* Explicit close (always works, even if blur watcher doesn't fire) */}
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
        {messages.length === 0 && !isLoading && !error && (
          <div className={styles.emptyState}>How can I help you?</div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`${styles.message} ${msg.role === 'user' ? styles.user : styles.assistant}`}
          >
            {msg.role === 'user' ? (
              msg.content
            ) : (
              <MarkdownRenderer content={msg.content} />
            )}
          </div>
        ))}

        {isLoading && (
          <div className={`${styles.message} ${styles.assistant} ${styles.thinking}`}>
            Thinking…
          </div>
        )}

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
        <button
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
