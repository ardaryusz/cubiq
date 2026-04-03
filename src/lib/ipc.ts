import { invoke } from '@tauri-apps/api/core';
import type { Chat, Message, Settings } from '../types';

export const getSettings = () => invoke<Settings>('get_settings');
export const updateSettings = (settings: Settings) => invoke<void>('update_settings', { settings });

export const getChats = () => invoke<Chat[]>('get_chats');
export const createChat = (title: string) => invoke<number>('create_chat', { title });
export const renameChat = (id: number, title: string) => invoke<void>('rename_chat', { id, title });
export const archiveChat = (id: number, archived: boolean) => invoke<void>('archive_chat', { id, archived });
export const deleteChat = (id: number) => invoke<void>('delete_chat', { id });

export const getMessages = (chatId: number) =>
    invoke<Message[]>('get_messages', { chatId });

export const addMessage = (chatId: number, role: string, content: string) =>
    invoke<number>('add_message', { chatId, role, content });

export const sendChatMessage = (chatId: number) =>
    invoke<string>('send_chat_message', { chatId });

export const testConnection = (apiKey: string, modelUrl: string, modelName: string) =>
    invoke<string>('test_connection', { apiKey, modelUrl, modelName });
