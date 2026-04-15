import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from './store';
import Sidebar from './components/Sidebar/Sidebar';
import ChatArea from './components/Chat/ChatArea';
import SettingsModal from './components/Settings/SettingsModal';
import styles from './App.module.css';

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 260;
const SIDEBAR_COLLAPSED_WIDTH = 64;
const STORAGE_KEY_WIDTH = 'cubiq_sidebar_width';
const STORAGE_KEY_COLLAPSED = 'cubiq_sidebar_collapsed';

function App() {
  const initialize = useAppStore(state => state.initialize);
  const isLoading = useAppStore(state => state.isLoading);
  const isSettingsOpen = useAppStore(state => state.isSettingsOpen);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_WIDTH);
    return saved ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved))) : SIDEBAR_DEFAULT;
  });
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY_COLLAPSED) === 'true';
  });

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(sidebarWidth);

  useEffect(() => { initialize(); }, [initialize]);

  // ── Global Ctrl+N shortcut: new draft chat ────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        // Don't intercept when a text input/textarea is focused so typing 'n' is unaffected
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        useAppStore.getState().setActiveChat(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WIDTH, String(sidebarWidth));
  }, [sidebarWidth]);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed));
  }, [collapsed]);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - dragStartX.current;
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, dragStartWidth.current + delta));
      setSidebarWidth(newWidth);
      // Auto-expand when dragging if collapsed
      if (collapsed) setCollapsed(false);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth, collapsed]);

  if (isLoading) {
    return <div className={styles.loading}>Loading Cubiq...</div>;
  }

  const effectiveWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <div className={styles.appContainer}>
      {/* Sidebar with controlled width */}
      <div
        className={styles.sidebarWrapper}
        style={{ width: effectiveWidth }}
      >
        <Sidebar
          isCollapsed={collapsed}
          onCollapse={() => setCollapsed(true)}
          onExpand={() => setCollapsed(false)}
        />
      </div>

      {/* Resize divider */}
      <div
        className={`${styles.resizeDivider} ${collapsed ? styles.resizeDividerCollapsed : ''}`}
        onMouseDown={onDividerMouseDown}
        onClick={() => { if (collapsed) setCollapsed(false); }}
        title={collapsed ? 'Expand sidebar' : 'Drag to resize'}
      >
        <div className={styles.collapseToggle} onClick={e => { e.stopPropagation(); setCollapsed(c => !c); }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            {collapsed
              ? <path d="M3 1l6 5-6 5V1z" />
              : <path d="M9 1L3 6l6 5V1z" />
            }
          </svg>
        </div>
      </div>

      {/* Main content */}
      <main className={styles.mainContent} style={{ width: `calc(100% - ${effectiveWidth}px - 6px)` }}>
        <ChatArea />
      </main>

      {isSettingsOpen && <SettingsModal />}
    </div>
  );
}

export default App;
