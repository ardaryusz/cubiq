import { create } from 'zustand';
import type { Chat, Settings, Preset } from '../types';
import * as ipc from '../lib/ipc';

interface AppState {
  chats: Chat[];
  settings: Settings | null;
  presets: Preset[];
  activeChatId: number | null;
  showArchived: boolean;
  isSettingsOpen: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  setActiveChat: (id: number | null) => void;
  setShowArchived: (show: boolean) => void;
  setSettingsOpen: (isOpen: boolean) => void;
  
  // Data actions
  refreshChats: () => Promise<void>;
  refreshPresets: () => Promise<void>;
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
}

/** Apply the full app theme class to the document. */
function applyAppTheme(appTheme: string) {
  const classes = document.documentElement.classList;
  const toRemove: string[] = [];
  // Remove any legacy dark/accent classes and existing theme classes
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
  activeChatId: null,
  showArchived: false,
  isSettingsOpen: false,
  isLoading: true,
  error: null,

  initialize: async () => {
    try {
      set({ isLoading: true, error: null });
      const [settings, chats, presets] = await Promise.all([
        ipc.getSettings(),
        ipc.getChats(),
        ipc.getPresets(),
      ]);
      
      applyAppTheme(settings.app_theme);

      set({ settings, chats, presets, isLoading: false });
    } catch (err: unknown) {
      set({ error: String(err), isLoading: false });
    }
  },

  setActiveChat: (id) => set({ activeChatId: id }),
  setShowArchived: (show) => set({ showArchived: show }),
  setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),

  refreshChats: async () => {
    try {
      const chats = await ipc.getChats();
      set({ chats });
    } catch (error) {
      console.error("Failed to load chats", error);
    }
  },

  refreshPresets: async () => {
    try {
      const presets = await ipc.getPresets();
      set({ presets });
    } catch (error) {
      console.error("Failed to load presets", error);
    }
  },

  createChat: async (title) => {
    try {
      const id = await ipc.createChat(title);
      await get().refreshChats();
      set({ activeChatId: id });
      return id;
    } catch (error) {
      console.error("Failed to create chat", error);
      return null;
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
      console.error("Failed to create preset", error);
      return null;
    }
  },

  updatePreset: async (id, name, modelUrl, modelName, customModelName, customizationPrompt) => {
    try {
      await ipc.updatePreset(id, name, modelUrl, modelName, customModelName, customizationPrompt);
      await get().refreshPresets();
    } catch (error) {
      console.error("Failed to update preset", error);
    }
  },

  deletePreset: async (id) => {
    try {
      await ipc.deletePreset(id);
      await get().refreshPresets();
    } catch (error) {
      console.error("Failed to delete preset", error);
    }
  },

  duplicatePreset: async (id) => {
    try {
      const newId = await ipc.duplicatePreset(id);
      await get().refreshPresets();
      return newId;
    } catch (error) {
      console.error("Failed to duplicate preset", error);
      return null;
    }
  },

  exportPresets: async (presetIds) => {
    try {
      return await ipc.exportPresets(presetIds);
    } catch (error) {
      console.error("Failed to export presets", error);
      return null;
    }
  },

  importPresets: async (jsonContent) => {
    try {
      const ids = await ipc.importPresets(jsonContent);
      await get().refreshPresets();
      return ids;
    } catch (error) {
      console.error("Failed to import presets", error);
      return null;
    }
  },

  // ── Chat preset actions ────────────────────────────────────────────

  updateChatPreset: async (chatId, presetId) => {
    try {
      await ipc.updateChatPreset(chatId, presetId);
      await get().refreshChats();
    } catch (error) {
      console.error("Failed to update chat preset", error);
    }
  },

  lockChatPreset: async (chatId) => {
    try {
      await ipc.lockChatPreset(chatId);
      await get().refreshChats();
    } catch (error) {
      console.error("Failed to lock chat preset", error);
    }
  },
}));
