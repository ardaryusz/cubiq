import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store';
import type { Chat, Folder } from '../../types';
import {
  Plus, Archive, Settings as SettingsIcon,
  ChevronRight, MoreHorizontal, Check, X, Folder as FolderIcon,
  FolderOpen, Pencil, Trash2, PanelLeftClose, PanelRightOpen,
  Search, SearchX, MessageSquare
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
  const [expandedFolders, setExpandedFolders]   = useState<Set<number>>(new Set());
  const [chatsCollapsed, setChatsCollapsed]       = useState(false);
  const [workspacesCollapsed, setWorkspacesCollapsed] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingChatId, setRenamingChatId]   = useState<number | null>(null);
  const [renameValue, setRenameValue]           = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [brandingHovered, setBrandingHovered]   = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [searchQuery, setSearchQuery]           = useState('');
  const [deleteWorkspaceDialog, setDeleteWorkspaceDialog] = useState<DeleteFolderDialog | null>(null);
  const [quickSearchOpen, setQuickSearchOpen]   = useState(false);
  const [quickArchivedOpen, setQuickArchivedOpen] = useState(false);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');

  const renameInputRef     = useRef<HTMLInputElement>(null);
  const folderRenameRef    = useRef<HTMLInputElement>(null);
  const newFolderInputRef  = useRef<HTMLInputElement>(null);
  const subMenuRef         = useRef<HTMLDivElement>(null);
  const menuRef            = useRef<HTMLDivElement>(null);
  const isCommittingNewWorkspace = useRef(false);

  // ── focus helpers ────────────────────────────────────────────────
  useEffect(() => { if (renamingChatId)   renameInputRef.current?.focus(); },   [renamingChatId]);
  useEffect(() => { if (renamingFolderId) folderRenameRef.current?.focus(); },  [renamingFolderId]);
  useEffect(() => { if (creatingWorkspace)  newFolderInputRef.current?.focus(); }, [creatingWorkspace]);

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

  // ─── Folder expansion toggle ─────────────────────────────────────
  const toggleFolder = (id: number) => {
    setExpandedFolders(prev => {
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

  // ─── Workspace rename (inline) ───────────────────────────────────
  const commitWorkspaceRename = async () => {
    if (renamingFolderId && folderRenameValue.trim()) {
      await renameFolder(renamingFolderId, folderRenameValue.trim());
    }
    setRenamingFolderId(null);
  };

  const onWorkspaceRenameKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  commitWorkspaceRename();
    if (e.key === 'Escape') setRenamingFolderId(null);
  };

  // ─── Workspace creation ──────────────────────────────────────────
  const commitNewWorkspace = async () => {
    if (isCommittingNewWorkspace.current) return;
    const name = newWorkspaceName.trim();
    if (!name) {
      setCreatingWorkspace(false);
      return;
    }

    isCommittingNewWorkspace.current = true;
    try {
      await createFolder(name);
      setCreatingWorkspace(false);
      setNewWorkspaceName('');
    } finally {
      isCommittingNewWorkspace.current = false;
    }
  };

  const onNewWorkspaceKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter')  commitNewWorkspace();
    if (e.key === 'Escape') { setCreatingWorkspace(false); setNewWorkspaceName(''); }
  };

  // ─── Workspace delete (with confirmation dialog) ─────────────────
  const requestDeleteWorkspace = async (folder: Folder) => {
    const count = await ipc.getFolderChatCount(folder.id);
    setDeleteWorkspaceDialog({ folder, chatCount: count });
  };

  const confirmDeleteWorkspace = async () => {
    if (!deleteWorkspaceDialog) return;
    await deleteFolder(deleteWorkspaceDialog.folder.id);
    setDeleteWorkspaceDialog(null);
  };

  // ─── Folder kebab menu ───────────────────────────────────────────
  const openFolderMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
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
  const searchQueryLower = searchQuery.toLowerCase().trim();
  
  const visibleChats = chats.filter(c => {
    const matchesArchive = c.archived === showArchived;
    if (!matchesArchive) return false;
    if (!searchQueryLower) return true;
    return (c.title || 'Untitled').toLowerCase().includes(searchQueryLower);
  });

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

  const hasAnyMatches = visibleChats.length > 0;

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
      >
        {isCollapsed ? (
          <div className={styles.collapsedBrandWrap}
               onMouseEnter={() => setBrandingHovered(true)}
               onMouseLeave={() => setBrandingHovered(false)}>
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

      {isCollapsed ? (
        <div className={styles.collapsedRailContent}>
          <div className={styles.collapsedRail}>
            <button
              className={styles.railBtn}
              title="New chat"
              onClick={() => setActiveChat(null)}
            >
              <Plus size={20} />
            </button>
            <button
              className={styles.railBtn}
              title="Search chats"
              onClick={() => { setQuickSearchOpen(true); setQuickSearchQuery(''); }}
            >
              <Search size={20} />
            </button>
          </div>

          <div className={styles.collapsedRailBottom}>
            <button
              className={styles.railBtn}
              title="Archived chats"
              onClick={() => { setQuickArchivedOpen(true); setQuickSearchQuery(''); }}
            >
              <Archive size={20} />
            </button>
            <button
              className={styles.railBtn}
              title="Settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={20} />
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 1. New Chat button (now lazy) */}
          <div className={styles.primaryActionsRow}>
            <button
              className={styles.newChatBtn}
              onClick={() => setActiveChat(null)}
            >
              <Plus size={16} />
              New chat
            </button>
          </div>

          {/* 2. Search row (now matches New Chat width) */}
          <div className={styles.searchRow}>
            <div className={styles.searchInputWrapper}>
              <Search size={14} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="Search chats…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setSearchQuery('');
                }}
              />
              {searchQuery && (
                <button
                  className={styles.searchClearBtn}
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* 3. Chats list (Grouped) */}
          <div className={styles.chatList}>

            {showArchived ? (
              /* Archived view */
              <div key="archived" className={styles.animatedSection}>
                {!hasAnyMatches && searchQuery && (
                  <div className={styles.emptySearchState}>
                    <SearchX size={32} className={styles.emptySearchIcon} />
                    <span className={styles.emptySearchText}>No matches found</span>
                  </div>
                )}
                {visibleChats.length === 0 ? (
                  !searchQuery && (
                    <div style={{ padding: '10px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      No archived chats
                    </div>
                  )
                ) : (
                  visibleChats.map(renderChatItem)
                )}
              </div>
            ) : (
              /* Active view restructuring */
              <>
                {!hasAnyMatches && searchQuery && (
                  <div className={styles.emptySearchState}>
                    <SearchX size={32} className={styles.emptySearchIcon} />
                    <span className={styles.emptySearchText}>No matches found</span>
                  </div>
                )}

                {/* 3a. Workspaces Accordion section */}
                <div className={styles.workspacesSection}>
                  <div className={styles.workspacesHeader} onClick={() => setWorkspacesCollapsed(p => !p)}>
                    <div className={styles.workspaceHeaderMain}>
                      <span>Workspaces</span>
                    </div>
                    <div className={styles.headerRightArea}>
                      <ChevronRight
                        size={12}
                        className={`${styles.headerChevron} ${(!workspacesCollapsed || !!searchQuery) ? styles.headerChevronOpen : ''} ${(workspacesCollapsed && !searchQuery) ? styles.headerChevronVisible : ''}`}
                      />
                      <span className={styles.folderCount}>
                        {folders.reduce((acc, f) => acc + (grouped[f.id]?.length || 0), 0)}
                      </span>
                    </div>
                  </div>

                  {(!workspacesCollapsed || !!searchQuery) && (
                    <>
                      {/* Subtle New Workspace row item */}
                      {!creatingWorkspace && (
                        <div
                          className={styles.newWorkspaceSubtle}
                          onClick={e => { e.stopPropagation(); setCreatingWorkspace(true); }}
                        >
                          <Plus size={14} />
                          <span>New workspace</span>
                        </div>
                      )}

                      {/* New Workspace input row */}
                      {creatingWorkspace && (
                        <div className={styles.newFolderRow}>
                          <FolderIcon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                          <input
                            ref={newFolderInputRef}
                            className={styles.newFolderInput}
                            placeholder="Workspace name…"
                            value={newWorkspaceName}
                            onChange={e => setNewWorkspaceName(e.target.value)}
                            onKeyDown={onNewWorkspaceKey}
                            onBlur={commitNewWorkspace}
                          />
                          <button className={styles.newFolderConfirmBtn} onMouseDown={commitNewWorkspace}>
                            <Check size={14} />
                          </button>
                          <button className={styles.newFolderCancelBtn} onMouseDown={() => { setCreatingWorkspace(false); setNewWorkspaceName(''); }}>
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      <div className={styles.workspacesList}>
                        {folders.map(folder => {
                          const folderChats = grouped[folder.id] ?? [];
                          const isExpanded = expandedFolders.has(folder.id);
                          const isRenamingF = renamingFolderId === folder.id;

                          if (searchQuery && folderChats.length === 0) return null;

                          return (
                            <div key={folder.id} className={styles.folderSection}>
                            <div
                              className={styles.folderHeader}
                              onClick={() => !isRenamingF && toggleFolder(folder.id)}
                              onContextMenu={e => openFolderMenu(e, folder)}
                            >
                              {isRenamingF ? (
                                <input
                                  ref={folderRenameRef}
                                  className={styles.folderNameInput}
                                  value={folderRenameValue}
                                  onChange={e => setFolderRenameValue(e.target.value)}
                                  onBlur={commitWorkspaceRename}
                                  onKeyDown={onWorkspaceRenameKey}
                                  onClick={e => e.stopPropagation()}
                                />
                              ) : (
                                <>
                                  <div className={styles.folderHeaderLeft}>
                                    {(isExpanded || !!searchQuery)
                                      ? <FolderOpen size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
                                      : <FolderIcon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />
                                    }
                                    <span className={styles.folderName}>{folder.name}</span>
                                  </div>
                                  <div className={styles.folderHeaderRight}>
                                    <ChevronRight
                                      size={12}
                                      className={`${styles.headerChevron} ${(isExpanded || !!searchQuery) ? styles.headerChevronOpen : ''}`}
                                    />
                                    <button
                                      className={styles.folderMenuBtn}
                                      title="Workspace options"
                                      onClick={e => { e.stopPropagation(); openFolderMenu(e, folder); }}
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                    <span className={styles.folderCount}>{folderChats.length}</span>
                                  </div>
                                </>
                              )}
                            </div>

                              {(isExpanded || !!searchQuery) && (
                                <div className={styles.folderChildren}>
                                  {folderChats.length === 0 ? (
                                    <div style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                      Empty Workspace
                                    </div>
                                  ) : (
                                    folderChats.map(renderChatItem)
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* 3b. Chats section (ungrouped) */}
                {(!searchQuery || ungrouped.length > 0) && (
                  <div className={styles.folderSection}>
                    <div
                      className={styles.chatsHeading}
                      onClick={() => setChatsCollapsed(p => !p)}
                    >
                      <span>Chats</span>
                      <div className={styles.folderHeaderRight}>
                        <ChevronRight
                          size={12}
                          className={`${styles.headerChevron} ${(!chatsCollapsed || !!searchQuery) ? styles.headerChevronOpen : ''} ${(chatsCollapsed && !searchQuery) ? styles.headerChevronVisible : ''}`}
                        />
                        <span className={styles.folderCount}>{ungrouped.length}</span>
                      </div>
                    </div>
                    {(!chatsCollapsed || !!searchQuery) && (
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
                )}
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
        </>
      )}

      {/* Context Menu Portal */}
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

          {/* Remove from Workspace */}
          {!showArchived && contextMenu.chat.folder_id != null && (() => {
            const folder = folders.find(f => f.id === contextMenu.chat.folder_id);
            return (
              <button className={styles.contextMenuItem} onClick={ctxRemoveFromFolder}>
                <X size={14} /> Remove from {folder?.name ?? 'Workspace'}
              </button>
            );
          })()}

          {/* Move to Workspace */}
          {!showArchived && (
            <div
              className={`${styles.contextMenuItem} ${styles.contextMenuSub}`}
              onMouseEnter={openMoveSubMenu}
            >
              <FolderIcon size={14} /> Move to Workspace
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

      {/* Move-to-workspace sub-panel */}
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
              No Workspaces yet
            </div>
          )}
        </div>,
        document.body
      )}

      {/* Workspace kebab menu portal */}
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
              requestDeleteWorkspace(folderMenuTarget.folder);
            }}
          >
            <Trash2 size={14} /> Delete Workspace
          </button>
        </div>,
        document.body
      )}

      {/* Delete Workspace Confirmation */}
      {deleteWorkspaceDialog && createPortal(
        <div className={styles.dialogOverlay} onClick={() => setDeleteWorkspaceDialog(null)}>
          <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>
              Delete Workspace &ldquo;{deleteWorkspaceDialog.folder.name}&rdquo;?
            </div>
            <div className={styles.dialogBody}>
              {deleteWorkspaceDialog.chatCount > 0 ? (
                <>
                  <strong>{deleteWorkspaceDialog.chatCount}</strong>{' '}
                  {deleteWorkspaceDialog.chatCount === 1 ? 'chat' : 'chats'} will be moved to{' '}
                  <strong>Chats</strong>. No chats will be deleted.
                </>
              ) : (
                'This Workspace is empty. It will be removed.'
              )}
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancelBtn} onClick={() => setDeleteWorkspaceDialog(null)}>
                Cancel
              </button>
              <button className={styles.dialogDeleteBtn} onClick={confirmDeleteWorkspace}>
                Delete Workspace
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* Quick Search Modal (Collapsed Rails) */}
      {quickSearchOpen && createPortal(
        <div className={styles.dialogOverlay} onClick={() => setQuickSearchOpen(false)}>
          <div className={`${styles.dialogBox} ${styles.quickActionModal}`} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>Search Chats</div>
            <div className={styles.dialogBody}>
              <div className={styles.searchInputWrapper} style={{ marginBottom: '12px' }}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  autoFocus
                  className={styles.searchInput}
                  placeholder="Type to search…"
                  value={quickSearchQuery}
                  onChange={e => setQuickSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setQuickSearchOpen(false);
                  }}
                />
              </div>
              <div className={styles.quickResultsList}>
                {chats
                  .filter(c => !c.archived && c.title.toLowerCase().includes(quickSearchQuery.toLowerCase()))
                  .map(chat => (
                    <div
                      key={chat.id}
                      className={styles.quickResultItem}
                      onClick={() => {
                        setActiveChat(chat.id!);
                        setQuickSearchOpen(false);
                      }}
                    >
                      <MessageSquare size={14} className={styles.quietIcon} />
                      <span className={styles.quickResultTitle}>{chat.title}</span>
                    </div>
                  ))}
                {chats.filter(c => !c.archived && c.title.toLowerCase().includes(quickSearchQuery.toLowerCase())).length === 0 && (
                  <div className={styles.quiet}>No results found</div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Quick Archived Modal (Collapsed Rails) */}
      {quickArchivedOpen && createPortal(
        <div className={styles.dialogOverlay} onClick={() => setQuickArchivedOpen(false)}>
          <div className={`${styles.dialogBox} ${styles.quickActionModal}`} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>Archived Chats</div>
            <div className={styles.dialogBody}>
              <div className={styles.searchInputWrapper} style={{ marginBottom: '12px' }}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  autoFocus
                  className={styles.searchInput}
                  placeholder="Filter archived…"
                  value={quickSearchQuery}
                  onChange={e => setQuickSearchQuery(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setQuickArchivedOpen(false);
                  }}
                />
              </div>
              <div className={styles.quickResultsList}>
                {chats
                  .filter(c => c.archived && c.title.toLowerCase().includes(quickSearchQuery.toLowerCase()))
                  .map(chat => (
                    <div
                      key={chat.id}
                      className={styles.quickResultItem}
                      onClick={() => {
                        setActiveChat(chat.id!);
                        setQuickArchivedOpen(false);
                      }}
                    >
                      <Archive size={14} className={styles.quietIcon} />
                      <span className={styles.quickResultTitle}>{chat.title}</span>
                    </div>
                  ))}
                {chats.filter(c => c.archived && c.title.toLowerCase().includes(quickSearchQuery.toLowerCase())).length === 0 && (
                  <div className={styles.quiet}>No archived chats found</div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
