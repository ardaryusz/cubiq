import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store';
import type { Chat, Folder } from '../../types';
import {
  Plus, Archive, Settings as SettingsIcon,
  ChevronRight, MoreHorizontal, Check, X, Folder as FolderIcon,
  FolderOpen, Pencil, Trash2, PanelLeftClose, PanelRightOpen,
  Search, SearchX, MessageSquare, CheckSquare, MoveRight,
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
  'amber-terminal',
];

const HOLD_DELAY = 250;   // ms before drag arms
const DRAG_THRESHOLD = 6; // px movement required to actually start drag

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

interface DragState {
  chatId: number;
  chat: Chat;
  armed: boolean;  // hold delay completed
  active: boolean; // mouse moved past threshold
  startX: number;
  startY: number;
  previewX: number;
  previewY: number;
}

type DropTarget =
  | { type: 'folder'; folderId: number }
  | { type: 'chats' };

interface BulkDeleteDialog {
  count: number;
}

interface ToastState {
  message: string;
  id: number;
  undoIds?: number[]; // if set, show an Undo button that restores these chats
}

// ─────────────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────────────

export default function Sidebar({ onCollapse, onExpand, isCollapsed = false }: {
  onCollapse: () => void;
  onExpand: () => void;
  isCollapsed?: boolean;
}) {
  const appTheme      = useAppStore(s => s.settings?.app_theme || 'cubiq-dark');
  const chats         = useAppStore(s => s.chats);
  const folders       = useAppStore(s => s.folders);
  const activeChatId  = useAppStore(s => s.activeChatId);
  const showArchived  = useAppStore(s => s.showArchived);

  const setActiveChat    = useAppStore(s => s.setActiveChat);
  const setShowArchived  = useAppStore(s => s.setShowArchived);
  const setSettingsOpen  = useAppStore(s => s.setSettingsOpen);
  const renameChat       = useAppStore(s => s.renameChat);
  const archiveChat      = useAppStore(s => s.archiveChat);
  const deleteChat       = useAppStore(s => s.deleteChat);
  const moveChatToFolder = useAppStore(s => s.moveChatToFolder);
  const createFolder     = useAppStore(s => s.createFolder);
  const renameFolder     = useAppStore(s => s.renameFolder);
  const deleteFolder     = useAppStore(s => s.deleteFolder);
  const bulkArchiveChats = useAppStore(s => s.bulkArchiveChats);
  const bulkDeleteChats  = useAppStore(s => s.bulkDeleteChats);
  const bulkMoveChats    = useAppStore(s => s.bulkMoveChats);
  const restoreChats     = useAppStore(s => s.restoreChats);

  // ── local UI state ──────────────────────────────────────────────
  const [expandedFolders, setExpandedFolders]     = useState<Set<number>>(new Set());
  const [chatsCollapsed, setChatsCollapsed]         = useState(false);
  const [workspacesCollapsed, setWorkspacesCollapsed] = useState(true);
  const [contextMenu, setContextMenu]               = useState<ContextMenuState | null>(null);
  const [renamingChatId, setRenamingChatId]         = useState<number | null>(null);
  const [renameValue, setRenameValue]               = useState('');
  const [renamingFolderId, setRenamingFolderId]     = useState<number | null>(null);
  const [folderRenameValue, setFolderRenameValue]   = useState('');
  const [creatingWorkspace, setCreatingWorkspace]   = useState(false);
  const [brandingHovered, setBrandingHovered]       = useState(false);
  const [newWorkspaceName, setNewWorkspaceName]     = useState('');
  const [searchQuery, setSearchQuery]               = useState('');
  const [deleteWorkspaceDialog, setDeleteWorkspaceDialog] = useState<DeleteFolderDialog | null>(null);
  const [quickSearchOpen, setQuickSearchOpen]       = useState(false);
  const [quickArchivedOpen, setQuickArchivedOpen]   = useState(false);
  const [quickSearchQuery, setQuickSearchQuery]     = useState('');
  const [folderMenuTarget, setFolderMenuTarget]     = useState<{ folder: Folder; x: number; y: number } | null>(null);

  // ── multi-select state ─────────────────────────────────────────
  const [selectMode, setSelectMode]                 = useState(false);
  const [selectedIds, setSelectedIds]               = useState<Set<number>>(new Set());
  const [lastSelectedId, setLastSelectedId]         = useState<number | null>(null);
  const [lastSelectedSection, setLastSelectedSection] = useState<'chats' | number | null>(null); // 'chats' = ungrouped, number = folderId
  const [bulkDeleteDialog, setBulkDeleteDialog]     = useState<BulkDeleteDialog | null>(null);
  const [moveSubMenuOpen, setMoveSubMenuOpen]       = useState(false);
  const [toast, setToast]                           = useState<ToastState | null>(null);

  // ── drag state ─────────────────────────────────────────────────
  const [dragState, setDragState]                   = useState<DragState | null>(null);
  const [dropTarget, setDropTarget]                 = useState<DropTarget | null>(null);
  const dragHoldTimer                               = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStateRef                                = useRef<DragState | null>(null);

  // ── toast helper ────────────────────────────────────────────────────
  const showToast = useCallback((message: string, undoIds?: number[]) => {
    const id = Date.now();
    setToast({ message, id, undoIds });
    setTimeout(() => setToast(prev => prev?.id === id ? null : prev), 5000);
  }, []);

  const handleUndo = useCallback(async () => {
    if (!toast?.undoIds?.length) return;
    const ids = toast.undoIds;
    setToast(null);
    await restoreChats(ids);
  }, [toast, restoreChats]);

  // refs
  const renameInputRef     = useRef<HTMLInputElement>(null);
  const folderRenameRef    = useRef<HTMLInputElement>(null);
  const newFolderInputRef  = useRef<HTMLInputElement>(null);
  const subMenuRef         = useRef<HTMLDivElement>(null);
  const menuRef            = useRef<HTMLDivElement>(null);
  const searchInputRef     = useRef<HTMLInputElement>(null);
  const isCommittingNewWorkspace = useRef(false);

  // ── focus helpers ────────────────────────────────────────────────
  useEffect(() => { if (renamingChatId)   renameInputRef.current?.focus();  }, [renamingChatId]);
  useEffect(() => { if (renamingFolderId) folderRenameRef.current?.focus(); }, [renamingFolderId]);
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

  // ── close folder menu ────────────────────────────────────────────
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

  // ── Global keyboard shortcuts ────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // Ctrl+K: focus search
      if (mod && e.key === 'k') {
        e.preventDefault();
        if (isCollapsed) {
          onExpand();
          // slight delay so the sidebar renders before focus
          setTimeout(() => searchInputRef.current?.focus(), 50);
        } else {
          searchInputRef.current?.focus();
        }
        return;
      }

      // Escape: clear selection / close modals
      if (e.key === 'Escape') {
        if (bulkDeleteDialog) { setBulkDeleteDialog(null); return; }
        if (deleteWorkspaceDialog) { setDeleteWorkspaceDialog(null); return; }
        if (quickSearchOpen) { setQuickSearchOpen(false); return; }
        if (quickArchivedOpen) { setQuickArchivedOpen(false); return; }
        if (contextMenu) { closeMenu(); return; }
        if (folderMenuTarget) { setFolderMenuTarget(null); return; }
        if (moveSubMenuOpen) { setMoveSubMenuOpen(false); return; }
        if (searchQuery) { setSearchQuery(''); return; }
        if (selectMode) {
          setSelectMode(false);
          setSelectedIds(new Set());
          setLastSelectedId(null);
          setLastSelectedSection(null);
          return;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    isCollapsed, onExpand, selectMode, searchQuery, contextMenu, closeMenu,
    folderMenuTarget, quickSearchOpen, quickArchivedOpen, bulkDeleteDialog,
    deleteWorkspaceDialog, moveSubMenuOpen,
  ]);

  // ── exit select mode when archiving view changes ─────────────────
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setLastSelectedSection(null);
  }, [showArchived]);

  // ── Folder expansion toggle ─────────────────────────────────────
  const toggleFolder = (id: number) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Context menu open ──────────────────────────────────────────
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

  // ── Context menu actions ────────────────────────────────────────
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
    const chatId = chat.id!;
    closeMenu();
    if (confirm(`Move "${chat.title}" to Trash?`)) {
      await deleteChat(chatId);
      showToast('Moved to Trash.', [chatId]);
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

  // ── Chat rename (inline) ────────────────────────────────────────
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

  // ── Workspace rename (inline) ───────────────────────────────────
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

  // ── Workspace creation ──────────────────────────────────────────
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

  // ── Workspace delete (with confirmation dialog) ─────────────────
  const requestDeleteWorkspace = async (folder: Folder) => {
    const count = await ipc.getFolderChatCount(folder.id);
    setDeleteWorkspaceDialog({ folder, chatCount: count });
  };

  const confirmDeleteWorkspace = async () => {
    if (!deleteWorkspaceDialog) return;
    await deleteFolder(deleteWorkspaceDialog.folder.id);
    setDeleteWorkspaceDialog(null);
  };

  // ── Folder kebab menu ───────────────────────────────────────────
  const openFolderMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderMenuTarget({ folder, x: e.clientX, y: e.clientY });
  };

  // ─────────────────────────────────────────────────────────────────
  // Multi-select logic
  // ─────────────────────────────────────────────────────────────────

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
    setLastSelectedId(null);
    setLastSelectedSection(null);
    setMoveSubMenuOpen(false);
  }, []);

  const handleChatClick = (
    e: React.MouseEvent,
    chat: Chat,
    section: 'chats' | number, // 'chats' = ungrouped, number = folderId
    sectionChats: Chat[],
  ) => {
    const id = chat.id!;

    // Ctrl/Cmd click: toggle selection
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setSelectMode(true);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      setLastSelectedId(id);
      setLastSelectedSection(section);
      return;
    }

    // Shift click: range select within same section
    if (e.shiftKey && selectMode && lastSelectedId !== null && lastSelectedSection === section) {
      e.preventDefault();
      const ids = sectionChats.map(c => c.id!);
      const fromIdx = ids.indexOf(lastSelectedId);
      const toIdx   = ids.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const rangeIds = ids.slice(lo, hi + 1);
        setSelectedIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(rid => next.add(rid));
          return next;
        });
      }
      return;
    }

    // Normal click in select mode: toggle
    if (selectMode) {
      e.preventDefault();
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      setLastSelectedId(id);
      setLastSelectedSection(section);
      return;
    }

    // Normal click: open chat
    setActiveChat(id);
    setLastSelectedId(id);
    setLastSelectedSection(section);
  };

  // ── Bulk actions ────────────────────────────────────────────────
  const handleBulkMove = async (folderId: number | null) => {
    const ids = Array.from(selectedIds);
    setMoveSubMenuOpen(false);
    await bulkMoveChats(ids, folderId);
    exitSelectMode();
  };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    await bulkArchiveChats(ids, !showArchived);
    exitSelectMode();
    showToast(`${ids.length} chat${ids.length > 1 ? 's' : ''} ${showArchived ? 'unarchived' : 'archived'}.`);
  };

  const requestBulkDelete = () => {
    setBulkDeleteDialog({ count: selectedIds.size });
  };

  const confirmBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    setBulkDeleteDialog(null);
    await bulkDeleteChats(ids);
    exitSelectMode();
    showToast(`Moved to Trash (${count} chat${count > 1 ? 's' : ''}).`, ids);
  };

  // ─────────────────────────────────────────────────────────────────
  // Drag & Drop — press-and-hold on chat row
  // ─────────────────────────────────────────────────────────────────

  // keep ref in sync for the global mouse handlers
  useEffect(() => { dragStateRef.current = dragState; }, [dragState]);


  // Global mousemove / mouseup for drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      if (!ds.armed) return; // hold not expired yet

      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!ds.active && dist > DRAG_THRESHOLD) {
        // Activate drag
        setDragState(prev => prev ? { ...prev, active: true, previewX: e.clientX, previewY: e.clientY } : null);
        document.body.style.cursor = 'grabbing';
        return;
      }

      if (ds.active) {
        setDragState(prev => prev ? { ...prev, previewX: e.clientX, previewY: e.clientY } : null);
      }
    };

    const onMouseUp = async () => {
      const ds = dragStateRef.current;
      if (dragHoldTimer.current) { clearTimeout(dragHoldTimer.current); dragHoldTimer.current = null; }

      if (ds?.active && dropTarget) {
        // Perform the move
        const folderId = dropTarget.type === 'folder' ? dropTarget.folderId : null;
        await moveChatToFolder(ds.chatId, folderId);
      }

      document.body.style.cursor = '';
      setDragState(null);
      setDropTarget(null);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [dropTarget, moveChatToFolder]);

  const onChatMouseDown = (e: React.MouseEvent, chat: Chat) => {
    // Ignore in select mode, or when renaming, or right-click
    if (selectMode || renamingChatId === chat.id || e.button !== 0) return;
    // Ignore modifier keys (those are for multi-select)
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;

    const state: DragState = {
      chatId: chat.id!,
      chat,
      armed: false,
      active: false,
      startX,
      startY,
      previewX: startX,
      previewY: startY,
    };
    setDragState(state);
    dragStateRef.current = state;

    dragHoldTimer.current = setTimeout(() => {
      dragHoldTimer.current = null;
      setDragState(prev => prev ? { ...prev, armed: true } : null);
      if (dragStateRef.current) dragStateRef.current = { ...dragStateRef.current, armed: true };
    }, HOLD_DELAY);
  };

  const isDraggingActive = dragState?.active === true;
  const draggingChatId   = dragState?.chatId ?? null;

  // ─────────────────────────────────────────────────────────────────
  // Partition chats
  // ─────────────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────
  // Chat row renderer
  // ─────────────────────────────────────────────────────────────────

  const renderChatItem = (chat: Chat, section: 'chats' | number, sectionChats: Chat[]) => {
    const isActive      = chat.id === activeChatId;
    const isRenaming    = renamingChatId === chat.id;
    const isSelected    = selectedIds.has(chat.id!);
    const isDraggingThis = draggingChatId === chat.id && isDraggingActive;

    let className = styles.chatItem;
    if (isActive)      className += ` ${styles.chatItemActive}`;
    if (isSelected)    className += ` ${styles.chatItemSelected}`;
    if (isDraggingThis) className += ` ${styles.chatItemDragging}`;

    return (
      <button
        key={chat.id}
        className={className}
        onClick={e => !isRenaming && handleChatClick(e, chat, section, sectionChats)}
        onContextMenu={e => !selectMode && openContextMenu(e, chat)}
        onMouseDown={e => onChatMouseDown(e, chat)}
      >
        {selectMode && (
          <span className={`${styles.chatCheckbox} ${isSelected ? styles.chatCheckboxChecked : ''}`}>
            {isSelected && <Check size={11} />}
          </span>
        )}

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

  // ─────────────────────────────────────────────────────────────────
  // Drop zone handlers
  // ─────────────────────────────────────────────────────────────────

  const onDropZoneEnter = (target: DropTarget) => {
    if (!isDraggingActive) return;
    // Don't allow dropping onto the same folder the chat is already in
    const currentFolderId = dragState?.chat.folder_id ?? null;
    if (target.type === 'folder' && target.folderId === currentFolderId) return;
    if (target.type === 'chats' && currentFolderId === null) return;
    setDropTarget(target);
  };

  const onDropZoneLeave = () => {
    if (!isDraggingActive) return;
    setDropTarget(null);
  };

  const isDropTarget = (target: DropTarget): boolean => {
    if (!dropTarget) return false;
    if (target.type === 'chats' && dropTarget.type === 'chats') return true;
    if (target.type === 'folder' && dropTarget.type === 'folder') return dropTarget.folderId === target.folderId;
    return false;
  };

  // ─────────────────────────────────────────────────────────────────
  // Theme
  // ─────────────────────────────────────────────────────────────────

  const isDarkTheme = DARK_SIDEBAR_THEMES.includes(appTheme);
  const family      = isDarkTheme ? 'light' : 'dark';
  const brandingSrc = isCollapsed
    ? (family === 'light' ? lightLogo : darkLogo)
    : (family === 'light' ? lightFull : darkFull);

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <div className={`${styles.sidebar} ${isDraggingActive ? styles.sidebarDragging : ''}`}>

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
            <div className={styles.headerRightButtons}>
              {!showArchived && (
                <button
                  className={`${styles.selectToggleBtn} ${selectMode ? styles.selectToggleBtnActive : ''}`}
                  title={selectMode ? 'Exit select mode (Esc)' : 'Select chats'}
                  onClick={() => {
                    if (selectMode) exitSelectMode();
                    else setSelectMode(true);
                  }}
                >
                  <CheckSquare size={15} />
                </button>
              )}
              <button
                className={styles.collapseBtn}
                title="Collapse sidebar"
                onClick={onCollapse}
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
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
              title="Search chats (Ctrl+K)"
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
          {/* 1. New Chat button */}
          <div className={styles.primaryActionsRow}>
            <button
              className={styles.newChatBtn}
              onClick={() => setActiveChat(null)}
            >
              <Plus size={16} />
              New chat
            </button>
          </div>

          {/* 2. Search row */}
          <div className={styles.searchRow}>
            <div className={styles.searchInputWrapper}>
              <Search size={14} className={styles.searchIcon} />
              <input
                ref={searchInputRef}
                className={styles.searchInput}
                placeholder="Search chats… (Ctrl+K)"
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
                  visibleChats.map(c => renderChatItem(c, 'chats', visibleChats))
                )}
              </div>
            ) : (
              /* Active view */
              <>
                {!hasAnyMatches && searchQuery && (
                  <div className={styles.emptySearchState}>
                    <SearchX size={32} className={styles.emptySearchIcon} />
                    <span className={styles.emptySearchText}>No matches found</span>
                  </div>
                )}

                {/* 3a. Workspaces Accordion */}
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
                      {/* New Workspace row */}
                      {!creatingWorkspace && (
                        <div
                          className={styles.newWorkspaceSubtle}
                          onClick={e => { e.stopPropagation(); setCreatingWorkspace(true); }}
                        >
                          <Plus size={14} />
                          <span>New workspace</span>
                        </div>
                      )}

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
                          const isExpanded  = expandedFolders.has(folder.id);
                          const isRenamingF = renamingFolderId === folder.id;
                          const isTarget    = isDropTarget({ type: 'folder', folderId: folder.id });
                          const isValid     = isDraggingActive && dragState?.chat.folder_id !== folder.id;

                          if (searchQuery && folderChats.length === 0) return null;

                          return (
                            <div key={folder.id} className={styles.folderSection}>
                              <div
                                className={`${styles.folderHeader} ${isTarget ? styles.dropTargetActive : ''} ${isValid && !isTarget ? styles.dropTargetValid : ''}`}
                                onClick={() => !isRenamingF && toggleFolder(folder.id)}
                                onContextMenu={e => openFolderMenu(e, folder)}
                                onMouseEnter={() => onDropZoneEnter({ type: 'folder', folderId: folder.id })}
                                onMouseLeave={onDropZoneLeave}
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
                                    folderChats.map(c => renderChatItem(c, folder.id, folderChats))
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
                      className={`${styles.chatsHeading} ${isDropTarget({ type: 'chats' }) ? styles.dropTargetActive : ''} ${isDraggingActive && dragState?.chat.folder_id !== null ? styles.dropTargetValid : ''}`}
                      onClick={() => setChatsCollapsed(p => !p)}
                      onMouseEnter={() => onDropZoneEnter({ type: 'chats' })}
                      onMouseLeave={onDropZoneLeave}
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
                          ungrouped.map(c => renderChatItem(c, 'chats', ungrouped))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom actions OR Selection action bar */}
          {selectMode ? (
            <div className={styles.selectionBar}>
              <div className={styles.selectionBarInfo}>
                <span>{selectedIds.size} selected</span>
                <button className={styles.selectionBarClearBtn} onClick={exitSelectMode} title="Clear selection (Esc)">
                  <X size={14} />
                </button>
              </div>
              <div className={styles.selectionBarActions}>
                {/* Move to Workspace */}
                <div className={styles.selectionActionWrapper}>
                  <button
                    className={styles.selectionActionBtn}
                    disabled={selectedIds.size === 0}
                    onClick={() => setMoveSubMenuOpen(p => !p)}
                    title="Move to workspace"
                  >
                    <MoveRight size={15} />
                    Move
                  </button>
                  {moveSubMenuOpen && (
                    <div className={styles.selectionMoveMenu}>
                      <button className={styles.selectionMoveItem} onClick={() => handleBulkMove(null)}>
                        <X size={13} /> Chats (ungrouped)
                      </button>
                      {folders.map(f => (
                        <button key={f.id} className={styles.selectionMoveItem} onClick={() => handleBulkMove(f.id)}>
                          <FolderIcon size={13} /> {f.name}
                        </button>
                      ))}
                      {folders.length === 0 && (
                        <div className={styles.selectionMoveEmpty}>No workspaces</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Archive / Unarchive */}
                <button
                  className={styles.selectionActionBtn}
                  disabled={selectedIds.size === 0}
                  onClick={handleBulkArchive}
                  title={showArchived ? 'Unarchive selected' : 'Archive selected'}
                >
                  <Archive size={15} />
                  {showArchived ? 'Unarchive' : 'Archive'}
                </button>

                {/* Delete */}
                <button
                  className={`${styles.selectionActionBtn} ${styles.selectionActionBtnDanger}`}
                  disabled={selectedIds.size === 0}
                  onClick={requestBulkDelete}
                  title="Delete selected"
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </div>
          ) : (
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
          )}
        </>
      )}

      {/* ── Drag Preview ── */}
      {isDraggingActive && dragState && createPortal(
        <div
          className={styles.dragPreview}
          style={{ left: dragState.previewX + 12, top: dragState.previewY - 14 }}
          aria-hidden="true"
        >
          <MessageSquare size={13} />
          <span>{dragState.chat.title}</span>
        </div>,
        document.body,
      )}

      {/* ── Context Menu Portal ── */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          className={styles.contextMenu}
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className={styles.contextMenuItem} onClick={ctxRename}>
            <Pencil size={14} /> Rename
          </button>
          <button className={styles.contextMenuItem} onClick={ctxArchive}>
            <Archive size={14} /> {contextMenu.chat.archived ? 'Unarchive' : 'Archive'}
          </button>
          {!showArchived && contextMenu.chat.folder_id != null && (() => {
            const folder = folders.find(f => f.id === contextMenu.chat.folder_id);
            return (
              <button className={styles.contextMenuItem} onClick={ctxRemoveFromFolder}>
                <X size={14} /> Remove from {folder?.name ?? 'Workspace'}
              </button>
            );
          })()}
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
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuItemDanger}`}
            onClick={ctxDelete}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>,
        document.body,
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
        document.body,
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
        document.body,
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
        document.body,
      )}

      {/* Bulk Delete Confirmation */}
      {bulkDeleteDialog && createPortal(
        <div className={styles.dialogOverlay} onClick={() => setBulkDeleteDialog(null)}>
          <div className={styles.dialogBox} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogTitle}>
              Delete {bulkDeleteDialog.count} chat{bulkDeleteDialog.count > 1 ? 's' : ''}?
            </div>
            <div className={styles.dialogBody}>
              This will permanently delete{' '}
              <strong>{bulkDeleteDialog.count} chat{bulkDeleteDialog.count > 1 ? 's' : ''}</strong>.
              This action cannot be undone.
            </div>
            <div className={styles.dialogActions}>
              <button className={styles.dialogCancelBtn} onClick={() => setBulkDeleteDialog(null)}>
                Cancel
              </button>
              <button className={styles.dialogDeleteBtn} onClick={confirmBulkDelete}>
                Delete {bulkDeleteDialog.count} chat{bulkDeleteDialog.count > 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>,
        document.body,
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
        document.body,
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
        document.body,
      )}

      {/* Toast */}
      {toast && createPortal(
        <div className={styles.toast}>
          <Check size={14} />
          <span>{toast.message}</span>
          {toast.undoIds?.length && (
            <button className={styles.toastUndoBtn} onClick={handleUndo}>
              Undo
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
