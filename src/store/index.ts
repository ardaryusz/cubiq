import { create } from 'zustand';
import type { Chat, Settings } from '../types';
import * as ipc from '../lib/ipc';

interface AppState {
  chats: Chat[];
  settings: Settings | null;
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
  createChat: (title: string) => Promise<number | null>;
  renameChat: (id: number, title: string) => Promise<void>;
  archiveChat: (id: number, archived: boolean) => Promise<void>;
  deleteChat: (id: number) => Promise<void>;
  updateSettings: (settings: Settings) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  chats: [],
  settings: null,
  activeChatId: null,
  showArchived: false,
  isSettingsOpen: false,
  isLoading: true,
  error: null,

  initialize: async () => {
    try {
      set({ isLoading: true, error: null });
      const [settings, chats] = await Promise.all([
        ipc.getSettings(),
        ipc.getChats(),
      ]);
      
      // Apply theme
      if (settings.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (settings.theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
           document.documentElement.classList.add('dark');
        } else {
           document.documentElement.classList.remove('dark');
        }
      }

      set({ settings, chats, isLoading: false });
    } catch (err: any) {
      set({ error: err.toString(), isLoading: false });
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
      
      // Re-apply theme
      if (settings.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (settings.theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
           document.documentElement.classList.add('dark');
        } else {
           document.documentElement.classList.remove('dark');
        }
      }

      set({ settings });
    } catch (err: any) {
      set({ error: err.toString() });
    }
  }
}));
