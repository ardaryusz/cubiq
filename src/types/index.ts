export interface Chat {
  id?: number;
  title: string;
  created_at: number;
  updated_at: number;
  archived: boolean;
}

export interface Message {
  id?: number;
  chat_id: number;
  role: string;
  content: string;
  created_at: number;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  api_key: string;
  model_url: string;
  model_name: string;
}
