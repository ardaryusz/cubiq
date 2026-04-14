import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store';
import type { Chat, Folder } from '../../types';
import {
  Plus, FolderPlus, Archive, Settings as SettingsIcon,
  ChevronRight, MoreHorizontal, Check, X, Folder as FolderIcon,
  FolderOpen, Pencil, Trash2, PanelLeftClose, PanelRightOpen,
} from 'lucide-react';
import * as ipc from '../../lib/ipc';
import styles from './Sidebar.module.css';

import darkLogo from '../../assets/darkLogo.png';
import lightLogo from '../../assets/lightLogo.png';
import darkFull from '../../assets/darkFull.png';
import lightFull from '../../assets/lightFull.png';

const DARK_SIDEBAR_THEMES = [
  'cubiq-dark',
  'midnight-violet',
  'ocean-glass',
  'rose-noir',
  'amber-terminal'
];

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface ContextMenuState {
  chat: Chat;
  x: number;
  y: number;
  subMenuOpen: boolean;
  subMenuX: number;
  subMenuY: number;
}

interface DeleteFolderDialog {
  folder: Folder;
  chatCount: number;
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────

export default function Sidebar({ onCollapse, onExpand, isCollapsed = false }: { onCollapse: () => void, onExpand: () => void, isCollapsed?: boolean }) {
  const appTheme     = useAppStore(s => s.settings?.app_theme || 'cubiq-dark');
  const chats        = useAppStore(s => s.chats);
  const folders      = useAppStore(s => s.folders);
  const activeChatId = useAppStore(s => s.activeChatId);
  const showArchived = useAppStore(s => s.showArchived);

  const createChatSafe  = useAppStore(s => s.createChatSafe);
  const setActiveChat   = useAppStore(s => s.setActiveChat);
  const setShowArchived = useAppStore(s => s.setShowArchived);
  const setSettingsOpen = useAppStore(s => s.setSettingsOpen);
  const renameChat      = useAppStore(s => s.renameChat);
  const archiveChat     = useAppStore(s => s.archiveChat);
  const deleteChat      = useAppStore(s => s.deleteChat);
  const moveChatToFolder = useAppStore(s => s.moveChatToFolder);
  const createFolder    = useAppStore(s => s.createFolder);
  const renameFolder    = useAppStore(s => s.renameFolder);
  const deleteFolder    = useAppStore(s => s.deleteFolder);

  // ── local UI state ──────────────────────────────────────────────
  const [collapsedFolders, setCollapsedFolders] = useState<Set<number>>(new Set());
  const [chatsCollapsed, setChatsCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingChatId, setRenamingChatId]   = useState<number | null>(null);
  const [renameValue, setRenameValue]           = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [creatingFolder, setCreatingFolder]     = useState(false);
  const [brandingHovered, setBrandingHovered]   = useState(false);
  const [newFolderName, setNewFolderName]       = useState('');
  const [deleteFolderDialog, setDeleteFolderDialog] = useState<DeleteFolderDialog | null>(null);

  const renameInputRef     = useRef<HTMLInputElement>(null);
  const folderRenameRef    = useRef<HTMLInputElement>(null);
  const newFolderInputRef  = useRef<HTMLInputElement>(null);
  const subMenuRef         = useRef<HTMLDivElement>(null);
  const menuRef            = useRef<HTMLDivElement>(null);

  // ── focus helpers ────────────────────────────────────────────────
  useEffect(() => { if (renamingChatId)   renameInputRef.current?.focus(); },   [renamingChatId]);
  useEffect(() => { if (renamingFolderId) folderRenameRef.current?.focus(); },  [renamingFolderId]);
  useEffect(() => { if (creatingFolder)   newFolderInputRef.current?.focus(); }, [creatingFolder]);

  // ── close context menu on outside click / Escape / scroll ───────
  const closeMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey   = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    const onClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        !(subMenuRef.current && subMenuRef.current.contains(e.target as Node))
      ) closeMenu();
    };
    const onScroll = () => closeMenu();
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [contextMenu, closeMenu]);

  // ─── Folder collapse toggle ─────────────────────────────────────
  const toggleFolder = (id: number) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ─── Context menu open ──────────────────────────────────────────
  const openContextMenu = (e: React.MouseEvent, chat: Chat) => {
    e.preventDefault();
    e.stopPropagation();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const menuW = 180;
    const menuH = 180;
    const x = Math.min(e.clientX, viewportW - menuW - 8);
    const y = Math.min(e.clientY, viewportH - menuH - 8);
    setContextMenu({ chat, x, y, subMenuOpen: false, subMenuX: 0, subMenuY: 0 });
  };

  // ─── Context menu actions ────────────────────────────────────────
  const ctxRename = () => {
    if (!contextMenu) return;
    setRenamingChatId(contextMenu.chat.id ?? null);
    setRenameValue(contextMenu.chat.title);
    closeMenu();
  };

  const ctxArchive = async () => {
    if (!contextMenu) return;
    const { chat } = contextMenu;
    closeMenu();
    await archiveChat(chat.id!, !chat.archived);
  };

  const ctxDelete = async () => {
    if (!contextMenu) return;
    const { chat } = contextMenu;
    closeMenu();
    if (confirm(`Delete "${chat.title}"? This cannot be undone.`)) {
      await deleteChat(chat.id!);
    }
  };

  const openMoveSubMenu = (e: React.MouseEvent) => {
    if (!contextMenu) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu(prev => prev ? {
      ...prev,
      subMenuOpen: true,
      subMenuX: rect.right + 4,
      subMenuY: rect.top,
    } : null);
  };

  const ctxMoveToFolder = async (folderId: number | null) => {
    if (!contextMenu) return;
    const chatId = contextMenu.chat.id!;
    closeMenu();
    await moveChatToFolder(chatId, folderId);
  };

  const ctxRemoveFromFolder = async () => {
    if (!contextMenu) return;
    const chatId = contextMenu.chat.id!;
    closeMenu();
    await moveChatToFolder(chatId, null);
  };

  // ─── Chat rename (inline) ────────────────────────────────────────
  const commitRename = async () => {
    if (renamingChatId && renameValue.trim()) {
      await renameChat(renamingChatId, renameValue.trim());
    }
    setRenamingChatId(null);
  };

  const onRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  commitRename();
    if (e.key === 'Escape') setRenamingChatId(null);
  };

  // ─── Folder rename (inline) ──────────────────────────────────────
  const commitFolderRename = async () => {
    if (renamingFolderId && folderRenameValue.trim()) {
      await renameFolder(renamingFolderId, folderRenameValue.trim());
    }
    setRenamingFolderId(null);
  };

  const onFolderRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  commitFolderRename();
    if (e.key === 'Escape') setRenamingFolderId(null);
  };

  // ─── Folder creation ─────────────────────────────────────────────
  const commitNewFolder = async () => {
    if (newFolderName.trim()) {
      await createFolder(newFolderName.trim());
    }
    setCreatingFolder(false);
    setNewFolderName('');
  };

  const onNewFolderKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  commitNewFolder();
    if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
  };

  // ─── Folder delete (with confirmation dialog) ────────────────────
  const requestDeleteFolder = async (folder: Folder) => {
    const count = await ipc.getFolderChatCount(folder.id);
    setDeleteFolderDialog({ folder, chatCount: count });
  };

  const confirmDeleteFolder = async () => {
    if (!deleteFolderDialog) return;
    await deleteFolder(deleteFolderDialog.folder.id);
    setDeleteFolderDialog(null);
  };

  // ─── Folder kebab menu ───────────────────────────────────────────
  const openFolderMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    // Use a small popup-style context menu reusing same state type
    // but store as a folder-flavoured action handled separately
    // For simplicity: inline click triggers rename / delete directly
    // We'll show a tiny 2-item popover by opening the same context-menu portal
    // but targeting the folder instead (handled below via folderMenuTarget).
    setFolderMenuTarget({ folder, x: e.clientX, y: e.clientY });
  };

  const [folderMenuTarget, setFolderMenuTarget] = useState<{ folder: Folder; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!folderMenuTarget) return;
    const close = () => setFolderMenuTarget(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [folderMenuTarget]);

  // ─── Partition chats ─────────────────────────────────────────────
  const visibleChats = chats.filter(c => c.archived === showArchived);

  const grouped: Record<number, Chat[]> = {};
  const ungrouped: Chat[] = [];
  for (const chat of visibleChats) {
    if (chat.folder_id != null) {
      if (!grouped[chat.folder_id]) grouped[chat.folder_id] = [];
      grouped[chat.folder_id].push(chat);
    } else {
      ungrouped.push(chat);
    }
  }

  // ─── Chat row renderer ───────────────────────────────────────────
  const renderChatItem = (chat: Chat) => {
    const isActive   = chat.id === activeChatId;
    const isRenaming = renamingChatId === chat.id;

    return (
      <button
        key={chat.id}
        className={`${styles.chatItem} ${isActive ? styles.chatItemActive : ''}`}
        onClick={() => !isRenaming && setActiveChat(chat.id ?? null)}
        onContextMenu={e => openContextMenu(e, chat)}
      >
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className={styles.chatItemInput}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={onRenameKey}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className={styles.chatItemTitle}>{chat.title}</span>
        )}
      </button>
    );
  };

  const isDarkTheme = DARK_SIDEBAR_THEMES.includes(appTheme);
  const family = isDarkTheme ? 'light' : 'dark';
  const brandingSrc = isCollapsed
    ? (family === 'light' ? lightLogo : darkLogo)
    : (family === 'light' ? lightFull : darkFull);

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className={styles.sidebar}>

      {/* ── Branding & Header Row ── */}
      <div
        className={styles.brandingRow}
        style={{ justifyContent: isCollapsed ? 'center' : 'space-between', marginBottom: isCollapsed ? '0' : '16px' }}
        onMouseEnter={() => isCollapsed && setBrandingHovered(true)}
        onMouseLeave={() => setBrandingHovered(false)}
      >
        {isCollapsed ? (
          <div className={styles.collapsedBrandWrap}>
            <img
              src={brandingSrc}
              alt="Cubiq Logo"
              className={styles.brandLogoOnly}
              style={{ opacity: brandingHovered ? 0 : 1 }}
            />
            <button
              className={styles.expandSidebarBtn}
              title="Open sidebar"
              onClick={onExpand}
              style={{ opacity: brandingHovered ? 1 : 0, pointerEvents: brandingHovered ? 'auto' : 'none' }}
            >
              <PanelRightOpen size={18} />
            </button>
          </div>
        ) : (
          <>
            <img src={brandingSrc} alt="Cubiq Logo" className={styles.brandFull} />
            <button
              className={styles.collapseBtn}
              title="Collapse sidebar"
              onClick={onCollapse}
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      {!isCollapsed && (
        <>
          {/* ── Primary Actions Row ── */}
          <div className={styles.primaryActionsRow}>
            <button className={styles.newChatBtn} onClick={createChatSafe}>
              <Plus size={16} />
              New chat
            </button>
            <button
              className={styles.newFolderBtn}
              title="New folder"
              onClick={() => setCreatingFolder(true)}
            >
              <FolderPlus size={16} />
            </button>
          </div>

          {/* ── New folder input row ── */}
          {creatingFolder && (
            <div className={styles.newFolderRow}>
          <FolderIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={newFolderInputRef}
            className={styles.newFolderInput}
            placeholder="Folder name…"
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={onNewFolderKey}
            onBlur={commitNewFolder}
          />
          <button className={styles.newFolderConfirmBtn} onMouseDown={commitNewFolder}>
            <Check size={14} />
          </button>
          <button className={styles.newFolderCancelBtn} onMouseDown={() => { setCreatingFolder(false); setNewFolderName(''); }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Chat / folder list ── */}
      <div className={styles.chatList}>

        {showArchived ? (
          /* ── Archived view: flat list with slide-in animation ── */
          <div key="archived" className={styles.animatedSection}>
            {visibleChats.length === 0 ? (
              <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No archived chats
              </div>
            ) : (
              visibleChats.map(renderChatItem)
            )}
          </div>
        ) : (
          /* ── Active view: folder groups + ungrouped ── */
          <>
            {folders.map(folder => {
              const folderChats = grouped[folder.id] ?? [];
              const isCollapsed = collapsedFolders.has(folder.id);
              const isRenamingF = renamingFolderId === folder.id;

              return (
                <div key={folder.id} className={styles.folderSection}>
                  <div
                    className={styles.folderHeader}
                    onClick={() => !isRenamingF && toggleFolder(folder.id)}
                    onContextMenu={e => openFolderMenu(e, folder)}
                  >
                    <ChevronRight
                      size={12}
                      className={`${styles.folderChevron} ${!isCollapsed ? styles.folderChevronOpen : ''}`}
                    />

                    {isRenamingF ? (
                      <input
                        ref={folderRenameRef}
                        className={styles.folderNameInput}
                        value={folderRenameValue}
                        onChange={e => setFolderRenameValue(e.target.value)}
                        onBlur={commitFolderRename}
                        onKeyDown={onFolderRenameKey}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        {isCollapsed
                          ? <FolderIcon size={13} style={{ flexShrink: 0 }} />
                          : <FolderOpen size={13} style={{ flexShrink: 0 }} />
                        }
                        <span className={styles.folderName}>{folder.name}</span>
                        <span className={styles.folderCount}>{folderChats.length}</span>
                      </>
                    )}

                    <button
                      className={styles.folderMenuBtn}
                      title="Folder options"
                      onClick={e => openFolderMenu(e, folder)}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                  </div>

                  {!isCollapsed && (
                    <div className={styles.folderChildren}>
                      {folderChats.length === 0 ? (
                        <div style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Empty folder
                        </div>
                      ) : (
                        folderChats.map(renderChatItem)
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Default "Chats" root section (always visible) ── */}
            <div className={styles.folderSection}>
              <div
                className={styles.chatsHeading}
                onClick={() => setChatsCollapsed(p => !p)}
              >
                <ChevronRight
                  size={12}
                  className={`${styles.folderChevron} ${!chatsCollapsed ? styles.folderChevronOpen : ''}`}
                />
                <span>Chats</span>
                <span className={styles.folderCount}>{ungrouped.length}</span>
              </div>
              {!chatsCollapsed && (
                <div className={styles.chatsChildren}>
                  {ungrouped.length === 0 ? (
                    <div style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      No chats yet
                    </div>
                  ) : (
                    ungrouped.map(renderChatItem)
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className={styles.bottomActions}>
        <button
          className={styles.actionBtn}
          onClick={() => { setShowArchived(!showArchived); setActiveChat(null); }}
        >
          <Archive size={18} />
          {showArchived ? 'Active chats' : 'Archived chats'}
        </button>
        <button className={styles.actionBtn} onClick={() => setSettingsOpen(true)}>
          <SettingsIcon size={18} />
          Settings
        </button>
      </div>
      </>)}

      {/* ═══════════════════════════════════════════════════════════
          Context Menu Portal
      ═══════════════════════════════════════════════════════════ */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {/* Rename */}
          <button className={styles.contextMenuItem} onClick={ctxRename}>
            <Pencil size={14} /> Rename
          </button>

          {/* Archive / Unarchive */}
          <button className={styles.contextMenuItem} onClick={ctxArchive}>
            <Archive size={14} /> {contextMenu.chat.archived ? 'Unarchive' : 'Archive'}
          </button>

          {/* Remove from folder (only if chat is inside a folder) */}
          {!showArchived && contextMenu.chat.folder_id != null && (() => {
            const folder = folders.find(f => f.id === contextMenu.chat.folder_id);
            return (
              <button className={styles.contextMenuItem} onClick={ctxRemoveFromFolder}>
                <X size={14} /> Remove from {folder?.name ?? 'Folder'}
              </button>
            );
          })()}

          {/* Move to Folder (only in active view) */}
          {!showArchived && (
            <div
              className={`${styles.contextMenuItem} ${styles.contextMenuSub}`}
              onMouseEnter={openMoveSubMenu}
            >
              <FolderIcon size={14} /> Move to Folder
              <ChevronRight size={12} style={{ marginLeft: 'auto' }} />
            </div>
          )}

          <div className={styles.contextMenuDivider} />

          {/* Delete */}
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
            onClick={ctxDelete}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>,
        document.body
      )}

      {/* ── Move-to-folder sub-panel ── */}
      {contextMenu?.subMenuOpen && createPortal(
        <div
          ref={subMenuRef}
          className={styles.contextMenuSubPanel}
          style={{ top: contextMenu.subMenuY, left: contextMenu.subMenuX }}
        >
          <button className={styles.contextMenuSubItem} onClick={() => ctxMoveToFolder(null)}>
            <X size={13} /> Chats (default)
          </button>
          {folders.map(f => (
            <button
              key={f.id}
              className={styles.contextMenuSubItem}
              onClick={() => ctxMoveToFolder(f.id)}
            >
              <FolderIcon size={13} /> {f.name}
            </button>
          ))}
          {folders.length === 0 && (
            <div style={{ padding: '6px 12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              No folders yet
            </div>
          )}
        </div>,
        document.body
      )}

      {/* ── Folder kebab menu portal ── */}
      {folderMenuTarget && createPortal(
        <div
          className={styles.contextMenu}
          style={{ top: folderMenuTarget.y, left: folderMenuTarget.x }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              setRenamingFolderId(folderMenuTarget.folder.id);
              setFolderRenameValue(folderMenuTarget.folder.name);
              setFolderMenuTarget(null);
            }}
          >
            <Pencil size={14} /> Rename
          </button>
          <div className={styles.contextMenuDivider} />
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
            onClick={() => {
              setFolderMenuTarget(null);
              requestDeleteFolder(folderMenuTarget.folder);
            }}
          >
            <Trash2 size={14} /> Delete Folder
          </button>
        </div>,
        document.body
      )}

      {/* ═══════════════════════════════════════════════════════════
          Delete Folder Confirmation Dialog
      ═══════════════════════════════════════════════════════════ */}
      {deleteFolderDialog && createPortal(
        <div className={styles.dialogOverlay} onClick={() => setDeleteFolderDialog(null)}>
          <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>
              Delete folder &ldquo;{deleteFolderDialog.folder.name}&rdquo;?
            </div>
            <div className={styles.dialogBody}>
              {deleteFolderDialog.chatCount > 0 ? (
                <>
                  <strong>{deleteFolderDialog.chatCount}</strong>{' '}
                  {deleteFolderDialog.chatCount === 1 ? 'chat' : 'chats'} will be moved to{' '}
                  <strong>Chats</strong>. No chats will be deleted.
                </>
              ) : (
                'This folder is empty. It will be removed.'
              )}
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancelBtn} onClick={() => setDeleteFolderDialog(null)}>
                Cancel
              </button>
              <button className={styles.dialogDeleteBtn} onClick={confirmDeleteFolder}>
                Delete Folder
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
