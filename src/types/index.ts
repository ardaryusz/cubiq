export interface Preset {
  id?: number;
  name: string;
  model_url: string;
  model_name: string;
  custom_model_name?: string;
  customization_prompt: string;
  is_builtin: boolean;
  created_at: number;
  updated_at: number;
}

export interface Chat {
  id?: number;
  title: string;
  created_at: number;
  updated_at: number;
  archived: boolean;
  preset_id?: number;
  preset_name_snapshot?: string;
  model_url_snapshot?: string;
  model_name_snapshot?: string;
  customization_snapshot?: string;
  preset_locked: boolean;
  user_edited_title: boolean;
  /** Folder this chat belongs to. undefined/null = No Folder (ungrouped). */
  folder_id?: number | null;
}

export interface Message {
  id?: number;
  chat_id: number;
  role: string;
  content: string;
  created_at: number;
}

export interface Settings {
  app_theme: string;
  theme: 'light' | 'dark' | 'system';
  accent_theme: string;
  api_key: string;
  model_url: string;
  model_name: string;
  selected_preset_id?: number;
}

export interface Folder {
  id: number;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
  /** Count of active (non-archived) chats in this folder. */
  chat_count: number;
}

export interface PresetExportItem {
  name: string;
  model_url: string;
  model_name: string;
  custom_model_name?: string;
  customization_prompt: string;
}

export interface PresetExportFile {
  cubiq_presets_version: number;
  exported_at: string;
  presets: PresetExportItem[];
}
