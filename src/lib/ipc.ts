import { invoke } from '@tauri-apps/api/core';
import type { Chat, DeletedChat, Folder, Message, Settings, Preset } from '../types';

// ── Settings ─────────────────────────────────────────────────────────
export const getSettings = () => invoke<Settings>('get_settings');
export const updateSettings = (settings: Settings) => invoke<void>('update_settings', { settings });

// ── Presets ──────────────────────────────────────────────────────────
export const getPresets = () => invoke<Preset[]>('get_presets');

export const createPreset = (
    name: string,
    modelUrl: string,
    modelName: string,
    customModelName: string | null,
    customizationPrompt: string,
) => invoke<number>('create_preset', { name, modelUrl, modelName, customModelName, customizationPrompt });

export const updatePreset = (
    id: number,
    name: string,
    modelUrl: string,
    modelName: string,
    customModelName: string | null,
    customizationPrompt: string,
) => invoke<void>('update_preset', { id, name, modelUrl, modelName, customModelName, customizationPrompt });

export const deletePreset = (id: number) => invoke<void>('delete_preset', { id });
export const duplicatePreset = (id: number) => invoke<number>('duplicate_preset', { id });

export const exportPresetsToFile = (path: string, presetIds?: number[]) =>
    invoke<void>('export_presets_to_file', { path, presetIds: presetIds ?? null });

export const importPresets = (jsonContent: string) =>
    invoke<number[]>('import_presets', { jsonContent });

// ── Chat Preset Management ──────────────────────────────────────────
export const updateChatPreset = (chatId: number, presetId: number) =>
    invoke<void>('update_chat_preset', { chatId, presetId });

export const lockChatPreset = (chatId: number) =>
    invoke<void>('lock_chat_preset', { chatId });

// ── Chats ────────────────────────────────────────────────────────────
export const getChats = () => invoke<Chat[]>('get_chats');
export const createChat = (title: string, presetId?: number | null) => invoke<number>('create_chat', { title, presetId: presetId ?? null });
export const renameChat = (id: number, title: string) => invoke<void>('rename_chat', { id, title });
export const archiveChat = (id: number, archived: boolean) => invoke<void>('archive_chat', { id, archived });
export const deleteChat = (id: number) => invoke<void>('delete_chat', { id });

// ── Messages ─────────────────────────────────────────────────────────
export const getMessages = (chatId: number) =>
    invoke<Message[]>('get_messages', { chatId });

export const addMessage = (chatId: number, role: string, content: string) =>
    invoke<number>('add_message', { chatId, role, content });

// ── AI ───────────────────────────────────────────────────────────────
export const testConnection = (apiKey: string, modelUrl: string, modelName: string) =>
    invoke<string>('test_connection', { apiKey, modelUrl, modelName });

// ── Folders ──────────────────────────────────────────────────────────
export const getFolders = () => invoke<Folder[]>('get_folders');
export const getFolderChatPreviews = (folderId: number) => invoke<import('../types').FolderChatPreview[]>('get_folder_chat_previews', { folderId });
export const createFolder = (name: string) => invoke<number>('create_folder', { name });
export const renameFolder = (id: number, name: string) => invoke<void>('rename_folder', { id, name });
export const deleteFolder = (id: number) => invoke<void>('delete_folder', { id });
export const getFolderChatCount = (folderId: number) => invoke<number>('get_folder_chat_count', { folderId });
export const moveChatToFolder = (chatId: number, folderId: number | null) =>
    invoke<void>('move_chat_to_folder', { chatId, folderId });

// ── Empty Chat Guard ──────────────────────────────────────────────────
export const findEmptyChat = () => invoke<number | null>('find_empty_chat');

// ── Bulk Actions ──────────────────────────────────────────────────────
export const bulkArchiveChats = (ids: number[], archived: boolean) =>
    invoke<void>('bulk_archive_chats', { ids, archived });

export const bulkDeleteChats = (ids: number[]) =>
    invoke<void>('bulk_delete_chats', { ids });

export const bulkMoveChats = (ids: number[], folderId: number | null) =>
    invoke<void>('bulk_move_chats', { ids, folderId });

// ── Trash ─────────────────────────────────────────────────────────────
export const getDeletedChats = () => invoke<DeletedChat[]>('get_deleted_chats');
export const restoreChats = (ids: number[]) => invoke<void>('restore_chats', { ids });
export const deleteChatsPermananently = (ids: number[]) => invoke<void>('delete_chats_permanently', { ids });
export const purgeExpiredDeletedChats = () => invoke<void>('purge_expired_deleted_chats');

// ── Streaming ─────────────────────────────────────────────────────────

export interface EphemeralMessage {
    role: string;
    content: string;
}

export const startEphemeralStream = (messages: EphemeralMessage[], requestId: string) =>
    invoke<void>('start_ephemeral_stream', { messages, requestId });

export const startChatStream = (chatId: number, requestId: string) =>
    invoke<void>('start_chat_stream', { chatId, requestId });

export const finalizeChatStream = (chatId: number, requestId: string, fullContent: string) =>
    invoke<void>('finalize_chat_stream', { chatId, requestId, fullContent });

export const cancelStream = (requestId: string) =>
    invoke<void>('cancel_stream', { requestId });

