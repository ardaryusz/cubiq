use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Preset {
    pub id: Option<i64>,
    pub name: String,
    pub model_url: String,
    pub model_name: String,
    pub custom_model_name: Option<String>,
    pub customization_prompt: String,
    pub is_builtin: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub id: Option<i64>,
    pub chat_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Chat {
    pub id: Option<i64>,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived: bool,
    pub preset_id: Option<i64>,
    pub preset_name_snapshot: Option<String>,
    pub model_url_snapshot: Option<String>,
    pub model_name_snapshot: Option<String>,
    pub customization_snapshot: Option<String>,
    pub preset_locked: bool,
    pub user_edited_title: bool,
    /// Folder this chat belongs to. NULL means ungrouped ("No Folder").
    /// Preserved even when the chat is archived so it returns to its folder on unarchive.
    pub folder_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    #[serde(default = "default_app_theme")]
    pub app_theme: String,
    pub theme: String,
    #[serde(default = "default_accent_theme")]
    pub accent_theme: String,
    pub api_key: String,
    pub model_url: String,
    pub model_name: String,
    #[serde(default)]
    pub selected_preset_id: Option<i64>,
}

fn default_app_theme() -> String {
    "cubiq-dark".to_string()
}

fn default_accent_theme() -> String {
    "emerald".to_string()
}

/// A single preset in the export format (no id, no is_builtin, no API key).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PresetExportItem {
    pub name: String,
    pub model_url: String,
    pub model_name: String,
    pub custom_model_name: Option<String>,
    pub customization_prompt: String,
}

/// Top-level versioned export file format.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PresetExportFile {
    pub cubiq_presets_version: u32,
    pub exported_at: String,
    pub presets: Vec<PresetExportItem>,
}

/// A folder that groups chats in the sidebar.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Folder {
    pub id: i64,
    pub name: String,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    /// Number of active (non-archived) chats in this folder. Computed at query time.
    pub chat_count: i64,
}
