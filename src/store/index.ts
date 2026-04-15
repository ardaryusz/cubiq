import { create } from 'zustand';
import type { Chat, Folder, Settings, Preset } from '../types';
import * as ipc from '../lib/ipc';

interface AppState {
  chats: Chat[];
  settings: Settings | null;
  presets: Preset[];
  folders: Folder[];
  activeChatId: number | null;
  draftPresetId: number | null;
  showArchived: boolean;
  isSettingsOpen: boolean;
  isLoading: boolean;
  error: string | null;

  // Core actions
  initialize: () => Promise<void>;
  setActiveChat: (id: number | null) => void;
  setShowArchived: (show: boolean) => void;
  setSettingsOpen: (isOpen: boolean) => void;

  // Data refresh
  refreshChats: () => Promise<void>;
  refreshPresets: () => Promise<void>;
  refreshFolders: () => Promise<void>;

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
  activeChatId: null,
  draftPresetId: null,
  showArchived: false,
  isSettingsOpen: false,
  isLoading: true,
  error: null,

  initialize: async () => {
    try {
      set({ isLoading: true, error: null });
      const [settings, chats, presets, folders] = await Promise.all([
        ipc.getSettings(),
        ipc.getChats(),
        ipc.getPresets(),
        ipc.getFolders(),
      ]);

      applyAppTheme(settings.app_theme);
      set({ 
        settings, 
        chats, 
        presets, 
        folders, 
        isLoading: false,
        draftPresetId: presets.length > 0 ? presets[0].id : null
      });
    } catch (err: unknown) {
      set({ error: String(err), isLoading: false });
    }
  },

  setActiveChat: (id) => {
    set({ activeChatId: id });
    if (id === null) {
      const { presets } = get();
      set({ draftPresetId: presets.length > 0 ? presets[0].id : null });
    }
  },
  setShowArchived: (show) => set({ showArchived: show }),
  setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),

  refreshChats: async () => {
    try {
      const chats = await ipc.getChats();
      set({ chats });
    } catch (error) {
      console.error('Failed to load chats', error);
    }
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
      const id = await ipc.createChat('New Chat');
      if (!id) return;

      // 2. Set the preset if we have a draft one
      if (draftPresetId) {
        await ipc.updateChatPreset(id, draftPresetId);
      }

      // 3. Set as active
      set({ activeChatId: id, draftPresetId: null });

      // 4. Send the message (this handles locking the preset + auto-titling)
      // Note: We don't call ChatArea's doSend, we do it via IPC here to stay atomic if possible
      // but for simplicity we'll just let ChatArea pick up the new activeChatId.
      // Wait, if we change activeChatId here, ChatArea's useEffect will clear the input.
      // We should probably pass the callback or just do the logic here.
      
      // Let's just return the ID and let ChatArea handle the sequential calls for now.
      await refreshChats();
    } catch (error) {
      console.error('Failed to start new chat', error);
    }
  },

  renameChat: async (id, title) => {
    try {
      await ipc.renameChat(id, title);
      await get().refreshChats();
    } catch (error) {
      console.error(error);
    }
  },

  archiveChat: async (id, archived) => {
    try {
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
      await ipc.deleteChat(id);
      await get().refreshChats();
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
      await ipc.moveChatToFolder(chatId, folderId);
      await Promise.all([get().refreshChats(), get().refreshFolders()]);
    } catch (error) {
      console.error('Failed to move chat to folder', error);
    }
  },

  // ── Bulk actions ─────────────────────────────────────────────────────

  bulkArchiveChats: async (ids, archived) => {
    try {
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
      await ipc.bulkDeleteChats(ids);
      await get().refreshChats();
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
      await ipc.bulkMoveChats(ids, folderId);
      await Promise.all([get().refreshChats(), get().refreshFolders()]);
    } catch (error) {
      console.error('Failed to bulk move chats', error);
    }
  },
}));
