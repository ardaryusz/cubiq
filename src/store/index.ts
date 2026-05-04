import { create } from 'zustand';
import type { Chat, DeletedChat, Folder, Settings, Preset } from '../types';
import * as ipc from '../lib/ipc';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// ── Tauri event payload shapes ───────────────────────────────────────────────
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

// Augment Window so we can use a typed sentinel without `as any`.
declare global {
  interface Window {
    __streamingListenersInited?: boolean;
  }
}

interface AppState {
  chats: Chat[];
  settings: Settings | null;
  presets: Preset[];
  folders: Folder[];
  deletedChats: DeletedChat[];
  activeChatId: number | null;
  activeFolderId: number | null;
  draftPresetId: number | null;
  initialDraftPrompt: string | null;
  showArchived: boolean;
  isSettingsOpen: boolean;
  isLoading: boolean;
  error: string | null;

  messages: Record<number, import('../types').Message[]>;
  streamingMessages: Record<number, { content: string; isStreaming: boolean; sendError?: string }>;
  
  // Sidebar state (startup defaults handled in initialize)
  workspacesCollapsed: boolean;
  expandedFolders: Set<number>;
  setWorkspacesCollapsed: (collapsed: boolean) => void;
  toggleFolderExpansion: (folderId: number) => void;
  
  initialize: () => Promise<void>;
  setActiveChat: (id: number | null) => void;
  setActiveFolder: (id: number | null) => void;
  setInitialDraftPrompt: (prompt: string | null) => void;
  setShowArchived: (show: boolean) => void;
  setSettingsOpen: (isOpen: boolean) => void;
  addOptimisticChat: (chat: Chat) => void;

  // Data refresh
  refreshChats: () => Promise<void>;
  refreshPresets: () => Promise<void>;
  refreshFolders: () => Promise<void>;
  refreshDeletedChats: () => Promise<void>;

  loadMessages: (chatId: number) => Promise<void>;
  initStreamingListeners: () => void;
  sendChatMessage: (chatId: number, content: string) => Promise<void>;
  startChatWithFirstPrompt: (folderId: number | null, prompt: string, presetId?: number | null) => Promise<void>;
  clearSendError: (chatId: number) => void;

  // Chat CRUD
  createChat: (title: string) => Promise<number | null>;
  renameChat: (id: number, title: string) => Promise<void>;
  archiveChat: (id: number, archived: boolean) => Promise<void>;
  deleteChat: (id: number) => Promise<void>;
  updateSettings: (settings: Settings) => Promise<void>;

  // Preset actions
  createPreset: (name: string, modelUrl: string, modelName: string, customModelName: string | null, customizationPrompt: string) => Promise<number | null>;
  updatePreset: (id: number, name: string, modelUrl: string, modelName: string, customModelName: string | null, customizationPrompt: string) => Promise<void>;
  deletePreset: (id: number) => Promise<void>;
  duplicatePreset: (id: number) => Promise<number | null>;
  exportPresets: (presetIds?: number[]) => Promise<string | null>;
  importPresets: (jsonContent: string) => Promise<number[] | null>;

  // Chat preset actions
  updateChatPreset: (chatId: number, presetId: number) => Promise<void>;
  lockChatPreset: (chatId: number) => Promise<void>;

  // Folder actions
  createFolder: (name: string) => Promise<number | null>;
  renameFolder: (id: number, name: string) => Promise<void>;
  deleteFolder: (id: number) => Promise<void>;
  moveChatToFolder: (chatId: number, folderId: number | null) => Promise<void>;

  // Empty chat guard (renamed/repurposed for lazy creation)
  startNewChat: () => Promise<void>;

  // Bulk actions
  bulkArchiveChats: (ids: number[], archived: boolean) => Promise<void>;
  bulkDeleteChats: (ids: number[]) => Promise<void>;
  bulkMoveChats: (ids: number[], folderId: number | null) => Promise<void>;

  // Trash actions
  restoreChats: (ids: number[]) => Promise<void>;
  deletePermanently: (ids: number[]) => Promise<void>;
  purgeExpiredDeletedChats: () => Promise<void>;
}

/** Apply the full app theme class to the document root. */
function applyAppTheme(appTheme: string) {
  const classes = document.documentElement.classList;
  const toRemove: string[] = [];
  classes.forEach(c => {
    if (c.startsWith('theme-') || c === 'dark' || c.startsWith('accent-')) {
      toRemove.push(c);
    }
  });
  toRemove.forEach(c => classes.remove(c));
  if (appTheme) {
    classes.add(`theme-${appTheme}`);
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  chats: [],
  settings: null,
  presets: [],
  folders: [],
  deletedChats: [],
  activeChatId: null,
  activeFolderId: null,
  draftPresetId: null,
  initialDraftPrompt: null,
  showArchived: false,
  isSettingsOpen: false,
  isLoading: true,
  error: null,
  messages: {},
  streamingMessages: {},
  workspacesCollapsed: true,
  expandedFolders: new Set<number>(),

  initialize: async () => {
    try {
      set({ isLoading: true, error: null });
      const [settings, chats, presets, folders, deletedChats] = await Promise.all([
        ipc.getSettings(),
        ipc.getChats(),
        ipc.getPresets(),
        ipc.getFolders(),
        ipc.getDeletedChats(),
      ]);

      applyAppTheme(settings.app_theme);
      set({ 
        settings, 
        chats, 
        presets, 
        folders,
        deletedChats,
        isLoading: false,
        draftPresetId: settings.selected_preset_id ?? (presets.length > 0 ? (presets[0].id ?? null) : null),
        expandedFolders: new Set(),
        workspacesCollapsed: (folders.length ?? 0) >= 6,
        activeChatId: settings.active_chat_id ?? null,
        activeFolderId: settings.active_folder_id ?? null
      });
    } catch (err: unknown) {
      set({ error: String(err), isLoading: false });
    }
  },

  setActiveChat: (id) => {
    set({ activeChatId: id, activeFolderId: null });
    if (id === null) {
      const { presets, settings } = get();
      set({ draftPresetId: settings?.selected_preset_id ?? (presets.length > 0 ? presets[0].id : null) });
    }
    const { settings, updateSettings } = get();
    if (settings) {
      const newSettings = { ...settings, active_chat_id: id, active_folder_id: null };
      if (id !== null) {
        newSettings.last_chat_id = id;
      }
      updateSettings(newSettings).catch(console.error);
    }
  },
  setActiveFolder: (id) => {
    set({ activeFolderId: id });
    if (id !== null) {
      set({ activeChatId: null });
    }
    const { settings, updateSettings } = get();
    if (settings) {
      const newSettings = { 
        ...settings, 
        active_folder_id: id, 
        active_chat_id: id !== null ? null : settings.active_chat_id 
      };
      updateSettings(newSettings).catch(console.error);
    }
  },
  setInitialDraftPrompt: (prompt) => set({ initialDraftPrompt: prompt }),
  setShowArchived: (show) => set({ showArchived: show }),
  setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
  addOptimisticChat: (chat) => set((state) => {
    // Merge if it already exists, otherwise prepend
    const exists = state.chats.some(c => c.id === chat.id);
    if (exists) {
      return { chats: state.chats.map(c => c.id === chat.id ? { ...c, ...chat } : c) };
    }
    return { chats: [chat, ...state.chats] };
  }),

  refreshChats: async () => {
    try {
      const chats = await ipc.getChats();
      set({ chats });
    } catch (error) {
      console.error('Failed to load chats', error);
    }
  },

  loadMessages: async (chatId) => {
    try {
      const msgs = await ipc.getMessages(chatId);
      set(state => ({
        messages: { ...state.messages, [chatId]: msgs }
      }));
    } catch (error) {
      console.error(`Failed to load messages for chat ${chatId}`, error);
    }
  },

  sendChatMessage: async (chatId, content) => {
    set(state => ({
      streamingMessages: {
        ...state.streamingMessages,
        [chatId]: { content: '', isStreaming: true, sendError: undefined }
      }
    }));
    try {
      // 1. Snapshot the preset if not locked
      const chat = get().chats.find(c => c.id === chatId);
      if (chat && !chat.preset_locked) {
        await get().lockChatPreset(chatId);
      }
      
      // 2. Add user message
      await ipc.addMessage(chatId, 'user', content);
      await get().loadMessages(chatId); // Refresh local store messages

      // 3. Start stream
      const requestId = `chat-${chatId}-${Date.now()}`;
      await ipc.startChatStream(chatId, requestId);
    } catch (e) {
      set(state => ({
        streamingMessages: {
          ...state.streamingMessages,
          [chatId]: { content: '', isStreaming: false, sendError: String(e) }
        }
      }));
      await get().loadMessages(chatId);
    }
  },

  startChatWithFirstPrompt: async (folderId, prompt, presetId) => {
    try {
      const id = await ipc.createChat("New Chat", presetId);
      if (!id) return;

      // 1. Optimistic insert
      get().addOptimisticChat({
        id,
        title: "New Chat",
        created_at: Date.now(),
        updated_at: Date.now(),
        archived: false,
        preset_locked: true,
        user_edited_title: false,
        folder_id: folderId
      });

      // 2. Move to folder if needed
      if (folderId !== null) {
        ipc.moveChatToFolder(id, folderId).catch(console.error);
      }

      // 3. Navigate instantly (sets activeChatId and clears activeFolderId)
      get().setActiveChat(id);

      // 4. Send the prompt and start streaming
      await get().sendChatMessage(id, prompt);
    } catch (e) {
      console.error("Failed to start chat with prompt:", e);
    }
  },

  clearSendError: (chatId) => {
    set(state => {
      const current = state.streamingMessages[chatId];
      if (!current) return state;
      return {
        streamingMessages: {
          ...state.streamingMessages,
          [chatId]: { ...current, sendError: undefined }
        }
      };
    });
  },

  initStreamingListeners: () => {
    // Prevent duplicate listeners
    if (window.__streamingListenersInited) return;
    window.__streamingListenersInited = true;

    listen<StreamDeltaPayload>('cubiq:stream_delta', ({ payload }) => {
      // Parse chatId from request_id if it follows "chat-{chatId}-..."
      const parts = payload.request_id?.split('-');
      if (parts && parts[0] === 'chat' && parts[1]) {
        const chatId = parseInt(parts[1], 10);
        if (!isNaN(chatId)) {
          set(state => {
            const current = state.streamingMessages[chatId];
            if (!current) return state;
            return {
              streamingMessages: {
                ...state.streamingMessages,
                [chatId]: { ...current, content: current.content + payload.delta }
              }
            };
          });
          console.log(`[Store] DELTA applied for chat ${chatId}, request_id=${payload.request_id}`);
        }
      }
    }).catch(console.error);

    listen<StreamDonePayload>('cubiq:stream_done', async ({ payload }) => {
      const parts = payload.request_id?.split('-');
      if (parts && parts[0] === 'chat' && parts[1]) {
        const chatId = parseInt(parts[1], 10);
        if (!isNaN(chatId)) {
          const finalContent = get().streamingMessages[chatId]?.content || '';
          
          set(state => ({
            streamingMessages: {
              ...state.streamingMessages,
              [chatId]: { content: finalContent, isStreaming: false }
            }
          }));

          if (finalContent.trim()) {
            try {
              await ipc.finalizeChatStream(chatId, payload.request_id, finalContent);
              await get().refreshChats();
              await get().loadMessages(chatId);
              // Clear streaming message placeholder
              set(state => {
                const copy = { ...state.streamingMessages };
                delete copy[chatId];
                return { streamingMessages: copy };
              });
            } catch (e) {
              set(state => ({
                streamingMessages: {
                  ...state.streamingMessages,
                  [chatId]: { content: finalContent, isStreaming: false, sendError: String(e) }
                }
              }));
            }
          } else {
            // Clear if empty
            set(state => {
              const copy = { ...state.streamingMessages };
              delete copy[chatId];
              return { streamingMessages: copy };
            });
          }
          console.log(`[Store] DONE applied for chat ${chatId}, request_id=${payload.request_id}`);
        }
      }
    }).catch(console.error);

    listen<StreamErrorPayload>('cubiq:stream_error', ({ payload }) => {
      const parts = payload.request_id?.split('-');
      if (parts && parts[0] === 'chat' && parts[1]) {
        const chatId = parseInt(parts[1], 10);
        if (!isNaN(chatId)) {
          set(state => {
            const current = state.streamingMessages[chatId] || { content: '' };
            return {
              streamingMessages: {
                ...state.streamingMessages,
                [chatId]: { ...current, isStreaming: false, sendError: payload.message }
              }
            };
          });
        }
      }
    }).catch(console.error);
  },

  refreshPresets: async () => {
    try {
      const presets = await ipc.getPresets();
      set({ presets });
    } catch (error) {
      console.error('Failed to load presets', error);
    }
  },

  refreshFolders: async () => {
    try {
      const folders = await ipc.getFolders();
      set({ folders });
    } catch (error) {
      console.error('Failed to load folders', error);
    }
  },

  refreshDeletedChats: async () => {
    try {
      const deletedChats = await ipc.getDeletedChats();
      set({ deletedChats });
    } catch (error) {
      console.error('Failed to load deleted chats', error);
    }
  },

  // ── Chat CRUD ────────────────────────────────────────────────────────

  createChat: async (title) => {
    try {
      const id = await ipc.createChat(title);
      await get().refreshChats();
      set({ activeChatId: id });
      return id;
    } catch (error) {
      console.error('Failed to create chat', error);
      return null;
    }
  },

  /** Guard: if an empty unlocked "New Chat" already exists, select it instead of creating another. */
  /** One-step startup for first message in a draft chat. */
  startNewChat: async () => {
    try {
      const { draftPresetId, refreshChats } = get();
      
      // 1. Create the chat row
      const id = await ipc.createChat('New Chat', draftPresetId);
      if (!id) return;

      // 2. Set as active
      set({ activeChatId: id, draftPresetId: null });

      // Let's just return the ID and let ChatArea handle the sequential calls for now.
      await refreshChats();
    } catch (error) {
      console.error('Failed to start new chat', error);
    }
  },

  renameChat: async (id, title) => {
    try {
      set(state => ({ chats: state.chats.map(c => c.id === id ? { ...c, title } : c) }));
      await ipc.renameChat(id, title);
      await get().refreshChats();
    } catch (error) {
      console.error(error);
    }
  },

  archiveChat: async (id, archived) => {
    try {
      set(state => ({ chats: state.chats.map(c => c.id === id ? { ...c, archived } : c) }));
      await ipc.archiveChat(id, archived);
      await get().refreshChats();
      if (archived && get().activeChatId === id) {
        set({ activeChatId: null });
      }
    } catch (error) {
      console.error(error);
    }
  },

  deleteChat: async (id) => {
    try {
      set(state => ({ chats: state.chats.filter(c => c.id !== id) }));
      await ipc.deleteChat(id);
      await get().refreshChats();
      await get().refreshDeletedChats();
      if (get().activeChatId === id) {
        set({ activeChatId: null });
      }
    } catch (error) {
      console.error(error);
    }
  },

  updateSettings: async (settings) => {
    try {
      await ipc.updateSettings(settings);
      applyAppTheme(settings.app_theme);
      set({ settings });
      // Broadcast theme change to all windows (QuickAsk picks this up live)
      emit('cubiq:theme_changed', { app_theme: settings.app_theme }).catch(() => {});
      // Update tray icon to match new theme
      invoke('sync_quickask_theme', { appTheme: settings.app_theme }).catch(() => {});
    } catch (err: unknown) {
      set({ error: String(err) });
    }
  },

  // ── Preset actions ─────────────────────────────────────────────────

  createPreset: async (name, modelUrl, modelName, customModelName, customizationPrompt) => {
    try {
      const id = await ipc.createPreset(name, modelUrl, modelName, customModelName, customizationPrompt);
      await get().refreshPresets();
      return id;
    } catch (error) {
      console.error('Failed to create preset', error);
      return null;
    }
  },

  updatePreset: async (id, name, modelUrl, modelName, customModelName, customizationPrompt) => {
    try {
      await ipc.updatePreset(id, name, modelUrl, modelName, customModelName, customizationPrompt);
      await get().refreshPresets();
    } catch (error) {
      console.error('Failed to update preset', error);
    }
  },

  deletePreset: async (id) => {
    try {
      await ipc.deletePreset(id);
      await get().refreshPresets();
    } catch (error) {
      console.error('Failed to delete preset', error);
    }
  },

  duplicatePreset: async (id) => {
    try {
      const newId = await ipc.duplicatePreset(id);
      await get().refreshPresets();
      return newId;
    } catch (error) {
      console.error('Failed to duplicate preset', error);
      return null;
    }
  },

  exportPresets: async (presetIds) => {
    try {
      return await ipc.exportPresets(presetIds);
    } catch (error) {
      console.error('Failed to export presets', error);
      return null;
    }
  },

  importPresets: async (jsonContent) => {
    try {
      const ids = await ipc.importPresets(jsonContent);
      await get().refreshPresets();
      return ids;
    } catch (error) {
      console.error('Failed to import presets', error);
      return null;
    }
  },

  // ── Chat preset actions ────────────────────────────────────────────

  updateChatPreset: async (chatId, presetId) => {
    try {
      await ipc.updateChatPreset(chatId, presetId);
      await get().refreshChats();
    } catch (error) {
      console.error('Failed to update chat preset', error);
    }
  },

  lockChatPreset: async (chatId) => {
    try {
      await ipc.lockChatPreset(chatId);
      await get().refreshChats();
    } catch (error) {
      console.error('Failed to lock chat preset', error);
    }
  },

  // ── Folder actions ──────────────────────────────────────────────────

  createFolder: async (name) => {
    try {
      const id = await ipc.createFolder(name);
      await get().refreshFolders();
      return id;
    } catch (error) {
      console.error('Failed to create folder', error);
      return null;
    }
  },

  renameFolder: async (id, name) => {
    try {
      await ipc.renameFolder(id, name);
      await get().refreshFolders();
    } catch (error) {
      console.error('Failed to rename folder', error);
    }
  },

  deleteFolder: async (id) => {
    try {
      await ipc.deleteFolder(id);
      // Chats' folder_id becomes null on the backend — refresh both
      await Promise.all([get().refreshFolders(), get().refreshChats()]);
    } catch (error) {
      console.error('Failed to delete folder', error);
    }
  },

  moveChatToFolder: async (chatId, folderId) => {
    try {
      set(state => ({ chats: state.chats.map(c => c.id === chatId ? { ...c, folder_id: folderId } : c) }));
      await ipc.moveChatToFolder(chatId, folderId);
      await Promise.all([get().refreshChats(), get().refreshFolders()]);
    } catch (error) {
      console.error('Failed to move chat to folder', error);
    }
  },

  // ── Bulk actions ─────────────────────────────────────────────────────

  bulkArchiveChats: async (ids, archived) => {
    try {
      set(state => ({ chats: state.chats.map(c => (c.id !== undefined && ids.includes(c.id)) ? { ...c, archived } : c) }));
      await ipc.bulkArchiveChats(ids, archived);
      await get().refreshChats();
      // If the active chat was archived, deselect it
      const active = get().activeChatId;
      if (archived && active !== null && ids.includes(active)) {
        set({ activeChatId: null });
      }
    } catch (error) {
      console.error('Failed to bulk archive chats', error);
    }
  },

  bulkDeleteChats: async (ids) => {
    try {
      set(state => ({ chats: state.chats.filter(c => c.id !== undefined && !ids.includes(c.id)) }));
      await ipc.bulkDeleteChats(ids);
      await get().refreshChats();
      await get().refreshDeletedChats();
      const active = get().activeChatId;
      if (active !== null && ids.includes(active)) {
        set({ activeChatId: null });
      }
    } catch (error) {
      console.error('Failed to bulk delete chats', error);
    }
  },

  bulkMoveChats: async (ids, folderId) => {
    try {
      set(state => ({ chats: state.chats.map(c => (c.id !== undefined && ids.includes(c.id)) ? { ...c, folder_id: folderId } : c) }));
      await ipc.bulkMoveChats(ids, folderId);
      await Promise.all([get().refreshChats(), get().refreshFolders()]);
    } catch (error) {
      console.error('Failed to bulk move chats', error);
    }
  },

  // ── Trash actions ───────────────────────────────────────────────────

  restoreChats: async (ids) => {
    try {
      // Optimistic restore: Remove from deletedChats, they'll be refetched into `chats` soon
      set(state => ({ deletedChats: state.deletedChats.filter(c => !ids.includes(c.id)) }));
      await ipc.restoreChats(ids);
      await Promise.all([get().refreshChats(), get().refreshDeletedChats()]);
    } catch (error) {
      console.error('Failed to restore chats', error);
    }
  },

  deletePermanently: async (ids) => {
    try {
      await ipc.deleteChatsPermananently(ids);
      await get().refreshDeletedChats();
    } catch (error) {
      console.error('Failed to permanently delete chats', error);
    }
  },

  purgeExpiredDeletedChats: async () => {
    try {
      await ipc.purgeExpiredDeletedChats();
      await get().refreshDeletedChats();
    } catch (error) {
      console.error('Failed to purge expired chats', error);
    }
  },

  setWorkspacesCollapsed: (collapsed) => set({ workspacesCollapsed: collapsed }),

  toggleFolderExpansion: (folderId) => {
    set(state => {
      const next = new Set(state.expandedFolders);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return { expandedFolders: next };
    });
  },
}));
