import { invoke } from '@tauri-apps/api/core';
import type { Chat, Message, Settings, Preset } from '../types';

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

export const exportPresets = (presetIds?: number[]) =>
    invoke<string>('export_presets', { presetIds: presetIds ?? null });

export const importPresets = (jsonContent: string) =>
    invoke<number[]>('import_presets', { jsonContent });

// ── Chat Preset Management ──────────────────────────────────────────
export const updateChatPreset = (chatId: number, presetId: number) =>
    invoke<void>('update_chat_preset', { chatId, presetId });

export const lockChatPreset = (chatId: number) =>
    invoke<void>('lock_chat_preset', { chatId });

// ── Chats ────────────────────────────────────────────────────────────
export const getChats = () => invoke<Chat[]>('get_chats');
export const createChat = (title: string) => invoke<number>('create_chat', { title });
export const renameChat = (id: number, title: string) => invoke<void>('rename_chat', { id, title });
export const archiveChat = (id: number, archived: boolean) => invoke<void>('archive_chat', { id, archived });
export const deleteChat = (id: number) => invoke<void>('delete_chat', { id });

// ── Messages ─────────────────────────────────────────────────────────
export const getMessages = (chatId: number) =>
    invoke<Message[]>('get_messages', { chatId });

export const addMessage = (chatId: number, role: string, content: string) =>
    invoke<number>('add_message', { chatId, role, content });

// ── AI ───────────────────────────────────────────────────────────────
export const sendChatMessage = (chatId: number) =>
    invoke<string>('send_chat_message', { chatId });

export const testConnection = (apiKey: string, modelUrl: string, modelName: string) =>
    invoke<string>('test_connection', { apiKey, modelUrl, modelName });
