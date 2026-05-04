use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;
use crate::models::{Chat, DeletedChat, Folder, Message, Preset, Settings, PresetExportItem, PresetExportFile};

/// Global Cubiq identity prompt, always prepended to every AI request.
const CUBIQ_IDENTITY_PROMPT: &str = "You are Cubiq, the AI assistant inside the Cubiq desktop app. Identify yourself as Cubiq only when the user asks who you are. Do not identify yourself as ChatGPT, Meta AI, Claude, Gemini, or any other assistant brand. Do not mention your name in every response — only when directly asked.";

pub struct AppState {
    pub db: Mutex<Connection>,
}

// ── Settings ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT theme, accent_theme, api_key, model_url, model_name, selected_preset_id, app_theme, trash_retention_days, active_chat_id, active_folder_id, last_chat_id, cli_preset_id
         FROM settings WHERE id = 1"
    ).map_err(|e| e.to_string())?;

    let settings = stmt.query_row((), |row| {
        let app_theme: Result<String, _> = row.get(6);
        let retention: Result<i64, _> = row.get(7);
        let active_chat_id: Result<Option<i64>, _> = row.get(8);
        let active_folder_id: Result<Option<i64>, _> = row.get(9);
        let last_chat_id: Result<Option<i64>, _> = row.get(10);
        let cli_preset_id: Result<Option<i64>, _> = row.get(11);
        Ok(Settings {
            theme: row.get(0)?,
            accent_theme: row.get(1)?,
            api_key: row.get(2)?,
            model_url: row.get(3)?,
            model_name: row.get(4)?,
            selected_preset_id: row.get(5)?,
            app_theme: app_theme.unwrap_or_else(|_| "cubiq-dark".to_string()),
            trash_retention_days: retention.unwrap_or(7),
            active_chat_id: active_chat_id.unwrap_or(None),
            active_folder_id: active_folder_id.unwrap_or(None),
            last_chat_id: last_chat_id.unwrap_or(None),
            cli_preset_id: cli_preset_id.unwrap_or(None),
            ..Default::default()
        })
    }).map_err(|e| e.to_string())?;

    Ok(settings)
}

#[tauri::command]
pub fn update_settings(settings: Settings, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE settings SET theme = ?1, accent_theme = ?2, api_key = ?3, model_url = ?4, model_name = ?5, selected_preset_id = ?6, app_theme = ?7, trash_retention_days = ?8, active_chat_id = ?9, active_folder_id = ?10, last_chat_id = ?11, cli_preset_id = ?12 WHERE id = 1",
        (
            &settings.theme, &settings.accent_theme, &settings.api_key, &settings.model_url, 
            &settings.model_name, &settings.selected_preset_id, &settings.app_theme, 
            &settings.trash_retention_days, &settings.active_chat_id, &settings.active_folder_id,
            &settings.last_chat_id, &settings.cli_preset_id
        ),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Presets ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_presets(state: State<'_, AppState>) -> Result<Vec<Preset>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, name, model_url, model_name, custom_model_name, customization_prompt, is_builtin, created_at, updated_at
         FROM presets ORDER BY is_builtin DESC, name ASC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map((), |row| {
        Ok(Preset {
            id: row.get(0)?,
            name: row.get(1)?,
            model_url: row.get(2)?,
            model_name: row.get(3)?,
            custom_model_name: row.get(4)?,
            customization_prompt: row.get(5)?,
            is_builtin: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut presets = Vec::new();
    for p in iter {
        presets.push(p.map_err(|e| e.to_string())?);
    }
    Ok(presets)
}

#[tauri::command]
pub fn create_preset(
    name: String,
    model_url: String,
    model_name: String,
    custom_model_name: Option<String>,
    customization_prompt: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    db.execute(
        "INSERT INTO presets (name, model_url, model_name, custom_model_name, customization_prompt, is_builtin, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        rusqlite::params![name, model_url, model_name, custom_model_name, customization_prompt, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn update_preset(
    id: i64,
    name: String,
    model_url: String,
    model_name: String,
    custom_model_name: Option<String>,
    customization_prompt: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    // Prevent editing built-in presets
    let is_builtin: bool = db.query_row(
        "SELECT is_builtin FROM presets WHERE id = ?1",
        [&id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if is_builtin {
        return Err("Cannot edit a built-in preset.".to_string());
    }

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE presets SET name = ?1, model_url = ?2, model_name = ?3, custom_model_name = ?4, customization_prompt = ?5, updated_at = ?6 WHERE id = ?7",
        rusqlite::params![name, model_url, model_name, custom_model_name, customization_prompt, now, id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_preset(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    // Prevent deleting built-in presets
    let is_builtin: bool = db.query_row(
        "SELECT is_builtin FROM presets WHERE id = ?1",
        [&id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if is_builtin {
        return Err("Cannot delete a built-in preset.".to_string());
    }

    db.execute("DELETE FROM presets WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;

    // If this was the selected default preset, clear the selection
    db.execute(
        "UPDATE settings SET selected_preset_id = NULL WHERE selected_preset_id = ?1",
        [&id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn duplicate_preset(id: i64, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();

    // Read the source preset
    let (name, model_url, model_name, custom_model_name, customization_prompt): (String, String, String, Option<String>, String) = db.query_row(
        "SELECT name, model_url, model_name, custom_model_name, customization_prompt FROM presets WHERE id = ?1",
        [&id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    ).map_err(|e| e.to_string())?;

    let new_name = format!("{} (copy)", name);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    db.execute(
        "INSERT INTO presets (name, model_url, model_name, custom_model_name, customization_prompt, is_builtin, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        rusqlite::params![new_name, model_url, model_name, custom_model_name, customization_prompt, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

// ── Preset Import/Export ─────────────────────────────────────────────

#[tauri::command]
pub fn export_presets(preset_ids: Option<Vec<i64>>, state: State<'_, AppState>) -> Result<String, String> {
    let db = state.db.lock().unwrap();

    let presets: Vec<PresetExportItem> = if let Some(ids) = preset_ids {
        // Export specific presets
        let mut items = Vec::new();
        for id in ids {
            let item = db.query_row(
                "SELECT name, model_url, model_name, custom_model_name, customization_prompt FROM presets WHERE id = ?1",
                [&id],
                |row| Ok(PresetExportItem {
                    name: row.get(0)?,
                    model_url: row.get(1)?,
                    model_name: row.get(2)?,
                    custom_model_name: row.get(3)?,
                    customization_prompt: row.get(4)?,
                }),
            ).map_err(|e| e.to_string())?;
            items.push(item);
        }
        items
    } else {
        // Export all user (non-builtin) presets
        let mut stmt = db.prepare(
            "SELECT name, model_url, model_name, custom_model_name, customization_prompt FROM presets WHERE is_builtin = 0 ORDER BY name ASC"
        ).map_err(|e| e.to_string())?;

        let iter = stmt.query_map((), |row| {
            Ok(PresetExportItem {
                name: row.get(0)?,
                model_url: row.get(1)?,
                model_name: row.get(2)?,
                custom_model_name: row.get(3)?,
                customization_prompt: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for item in iter {
            items.push(item.map_err(|e| e.to_string())?);
        }
        items
    };

    let export_file = PresetExportFile {
        cubiq_presets_version: 1,
        exported_at: chrono_now_iso(),
        presets,
    };

    serde_json::to_string_pretty(&export_file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_presets_to_file(path: String, preset_ids: Option<Vec<i64>>, state: State<'_, AppState>) -> Result<(), String> {
    let json = export_presets(preset_ids, state)?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to save file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn import_presets(json_content: String, state: State<'_, AppState>) -> Result<Vec<i64>, String> {
    let export_file: PresetExportFile = serde_json::from_str(&json_content)
        .map_err(|e| format!("Invalid preset file format: {}", e))?;

    if export_file.cubiq_presets_version != 1 {
        return Err(format!(
            "Unsupported preset file version: {}. Expected version 1.",
            export_file.cubiq_presets_version
        ));
    }

    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    let mut imported_ids = Vec::new();

    for item in &export_file.presets {
        // Check for name conflicts and deduplicate
        let final_name = deduplicate_preset_name(&db, &item.name)?;

        db.execute(
            "INSERT INTO presets (name, model_url, model_name, custom_model_name, customization_prompt, is_builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
            rusqlite::params![final_name, item.model_url, item.model_name, item.custom_model_name, item.customization_prompt, now, now],
        ).map_err(|e| e.to_string())?;

        imported_ids.push(db.last_insert_rowid());
    }

    Ok(imported_ids)
}

/// If a preset name already exists, append " (imported)", " (imported 2)", etc.
fn deduplicate_preset_name(db: &Connection, base_name: &str) -> Result<String, String> {
    let exists: bool = db.query_row(
        "SELECT COUNT(*) > 0 FROM presets WHERE name = ?1",
        [base_name],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if !exists {
        return Ok(base_name.to_string());
    }

    // Try " (imported)", then " (imported 2)", " (imported 3)", ...
    let candidate = format!("{} (imported)", base_name);
    let exists: bool = db.query_row(
        "SELECT COUNT(*) > 0 FROM presets WHERE name = ?1",
        [&candidate],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if !exists {
        return Ok(candidate);
    }

    for i in 2..100 {
        let candidate = format!("{} (imported {})", base_name, i);
        let exists: bool = db.query_row(
            "SELECT COUNT(*) > 0 FROM presets WHERE name = ?1",
            [&candidate],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        if !exists {
            return Ok(candidate);
        }
    }

    Err("Too many presets with the same name.".to_string())
}

/// Simple ISO-8601 timestamp without pulling in the chrono crate.
fn chrono_now_iso() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    // Approximate UTC — good enough for export metadata
    let secs_per_day = 86400u64;
    let days = now / secs_per_day;
    let day_secs = now % secs_per_day;
    let hours = day_secs / 3600;
    let mins = (day_secs % 3600) / 60;
    let secs = day_secs % 60;

    // Days since epoch to Y-M-D (simplified)
    let mut y = 1970i32;
    let mut remaining = days as i64;
    loop {
        let days_in_year = if is_leap(y) { 366 } else { 365 };
        if remaining < days_in_year {
            break;
        }
        remaining -= days_in_year;
        y += 1;
    }
    let months_days: [i64; 12] = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 1u32;
    for &md in &months_days {
        if remaining < md {
            break;
        }
        remaining -= md;
        m += 1;
    }
    let d = remaining + 1;

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, hours, mins, secs)
}

fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

// ── Chat Preset Management ──────────────────────────────────────────

#[tauri::command]
pub fn update_chat_preset(_chat_id: i64, _preset_id: i64, _state: State<'_, AppState>) -> Result<(), String> {
    Err("Cannot change preset: this chat's preset is locked after creation.".to_string())
}

#[tauri::command]
pub fn lock_chat_preset(chat_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    db.execute(
        "UPDATE chats SET preset_locked = 1 WHERE id = ?1",
        [&chat_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ── Chats ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_chats(state: State<'_, AppState>) -> Result<Vec<Chat>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, title, created_at, updated_at, archived,
                preset_id, preset_name_snapshot, model_url_snapshot, model_name_snapshot,
                customization_snapshot, preset_locked, user_edited_title, folder_id, deleted_at
         FROM chats
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;

    let chat_iter = stmt.query_map((), |row| {
        Ok(Chat {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            archived: row.get(4)?,
            preset_id: row.get(5)?,
            preset_name_snapshot: row.get(6)?,
            model_url_snapshot: row.get(7)?,
            model_name_snapshot: row.get(8)?,
            customization_snapshot: row.get(9)?,
            preset_locked: row.get(10)?,
            user_edited_title: row.get(11)?,
            folder_id: row.get(12)?,
            deleted_at: row.get(13)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut chats = Vec::new();
    for chat in chat_iter {
        chats.push(chat.map_err(|e| e.to_string())?);
    }

    Ok(chats)
}

#[tauri::command]
pub fn create_chat(title: String, preset_id: Option<i64>, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    // Resolve preset_id: use provided, then cli default, then app default, then first available
    let resolved_preset_id: Option<i64> = preset_id.or_else(|| {
        let app_default: Option<i64> = db.query_row("SELECT selected_preset_id FROM settings WHERE id = 1", (), |r| r.get(0)).unwrap_or(None);
        if app_default.is_some() { return app_default; }
        db.query_row("SELECT id FROM presets ORDER BY id ASC LIMIT 1", (), |r| r.get(0)).ok()
    });

    let preset_data: Option<(i64, String, String, String, String)> = if let Some(pid) = resolved_preset_id {
        db.query_row(
            "SELECT id, name, model_url, model_name, customization_prompt FROM presets WHERE id = ?1",
            [&pid],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).ok()
    } else {
        None
    };

    let (preset_id, preset_name, model_url, model_name, customization) = match preset_data {
        Some((pid, name, url, model, cust)) => (Some(pid), Some(name), Some(url), Some(model), Some(cust)),
        None => (None, None, None, None, None),
    };

    db.execute(
        "INSERT INTO chats (title, created_at, updated_at, archived, preset_id, preset_name_snapshot, model_url_snapshot, model_name_snapshot, customization_snapshot, preset_locked, user_edited_title, folder_id)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7, ?8, 1, 0, NULL)",
        rusqlite::params![title, now, now, preset_id, preset_name, model_url, model_name, customization],
    ).map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn rename_chat(id: i64, title: String, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE chats SET title = ?1, updated_at = ?2, user_edited_title = 1 WHERE id = ?3",
        (&title, &now, &id),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn archive_chat(id: i64, archived: bool, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE chats SET archived = ?1, updated_at = ?2 WHERE id = ?3",
        (&archived, &now, &id),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Soft-deletes a single chat by setting deleted_at = now.
/// The chat disappears from normal lists; it lives in the Trash.
#[tauri::command]
pub fn delete_chat(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE chats SET deleted_at = ?1 WHERE id = ?2",
        [now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Messages ─────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_messages(chat_id: i64, state: State<'_, AppState>) -> Result<Vec<Message>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;

    let msg_iter = stmt.query_map([&chat_id], |row| {
        Ok(Message {
            id: row.get(0)?,
            chat_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for msg in msg_iter {
        messages.push(msg.map_err(|e| e.to_string())?);
    }

    Ok(messages)
}

#[tauri::command]
pub fn add_message(chat_id: i64, role: String, content: String, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    db.execute(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&chat_id, &role, &content, &now),
    ).map_err(|e| e.to_string())?;

    db.execute(
        "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
        (&now, &chat_id),
    ).map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

// ── AI Chat ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn send_chat_message(chat_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    // 1. Read API key from settings (always global)
    let api_key: String = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT api_key FROM settings WHERE id = 1",
            (),
            |row| row.get(0),
        ).map_err(|e| e.to_string())?
    };

    // 2. Read chat snapshot values (model_url, model_name, customization)
    //    Fall back to settings if snapshots are NULL (legacy safety net)
    let (model_url, model_name, customization_prompt): (String, String, String) = {
        let db = state.db.lock().unwrap();

        let (snap_url, snap_model, snap_cust): (Option<String>, Option<String>, Option<String>) = db.query_row(
            "SELECT model_url_snapshot, model_name_snapshot, customization_snapshot FROM chats WHERE id = ?1",
            [&chat_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| e.to_string())?;

        // Fall back to settings if snapshots are missing
        if snap_url.is_some() && snap_model.is_some() {
            (
                snap_url.unwrap(),
                snap_model.unwrap(),
                snap_cust.unwrap_or_default(),
            )
        } else {
            let (url, model): (String, String) = db.query_row(
                "SELECT model_url, model_name FROM settings WHERE id = 1",
                (),
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|e| e.to_string())?;
            (url, model, String::new())
        }
    };

    // 3. Build conversation with identity + customization prompts prepended
    let mut conversation: Vec<(String, String)> = Vec::new();

    // Always prepend global Cubiq identity prompt
    conversation.push(("system".to_string(), CUBIQ_IDENTITY_PROMPT.to_string()));

    // Prepend preset customization prompt if non-empty
    if !customization_prompt.is_empty() {
        conversation.push(("system".to_string(), customization_prompt));
    }

    // Append message history — also capture the first user message for auto-title
    let first_user_message: Option<String>;
    {
        let db = state.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT role, content FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&chat_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        let mut first_user = None;
        for row in rows {
            let (role, content) = row.map_err(|e| e.to_string())?;
            if role == "user" && first_user.is_none() {
                first_user = Some(content.clone());
            }
            conversation.push((role, content));
        }
        first_user_message = first_user;
    }

    // 4. Call the AI service
    let reply = crate::ai::chat_completion(&api_key, &model_url, &model_name, conversation)
        .await
        .map_err(|e| e.to_string())?;

    // 5. Persist the assistant reply
    {
        let db = state.db.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        db.execute(
            "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            (&chat_id, &"assistant", &reply, &now),
        )
        .map_err(|e| e.to_string())?;
        db.execute(
            "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
            (&now, &chat_id),
        )
        .map_err(|e| e.to_string())?;
    }

    // 6. Auto-title: generate a title after the first assistant reply
    //    Only if user_edited_title is false and title is still "New Chat"
    {
        let should_auto_title = {
            let db = state.db.lock().unwrap();
            let (title, user_edited): (String, bool) = db.query_row(
                "SELECT title, user_edited_title FROM chats WHERE id = ?1",
                [&chat_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).unwrap_or(("".to_string(), true));
            !user_edited && title == "New Chat"
        };

        if should_auto_title {
            if let Some(ref user_msg) = first_user_message {
                // Try AI-generated title first
                let title = try_generate_ai_title(&api_key, &model_url, &model_name, user_msg).await
                    .unwrap_or_else(|_| generate_fallback_title(user_msg));

                let db = state.db.lock().unwrap();
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as i64;
                // Update title but do NOT set user_edited_title (auto-title is not a user edit)
                let _ = db.execute(
                    "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3 AND user_edited_title = 0",
                    (&title, &now, &chat_id),
                );
            }
        }
    }

    Ok(reply)
}

/// Try to generate a title using the AI. Returns Err if anything goes wrong.
async fn try_generate_ai_title(
    api_key: &str,
    model_url: &str,
    model_name: &str,
    user_message: &str,
) -> Result<String, String> {
    let title_messages = vec![
        (
            "system".to_string(),
            "You are a title generator. Given a user message from a conversation, generate a concise 3-6 word title that summarizes the USER's topic or question. Focus on what the user is asking about, not how the assistant would reply. Reply with ONLY the title text. No quotes. No punctuation at the end. Do not include greetings or pleasantries in the title.".to_string(),
        ),
        ("user".to_string(), format!("Summarize this user message as a short title: {}", user_message)),
    ];

    let raw_title = crate::ai::chat_completion(api_key, model_url, model_name, title_messages)
        .await
        .map_err(|e| e.to_string())?;

    let title = raw_title.trim().trim_matches('"').trim().to_string();

    // Validate: non-empty and not absurdly long
    if title.is_empty() || title.len() > 80 {
        return Err("Invalid AI-generated title".to_string());
    }

    Ok(title)
}

/// Local fallback: derive a short title from the first user message.
fn generate_fallback_title(user_message: &str) -> String {
    let trimmed = user_message.trim();
    if trimmed.is_empty() {
        return "Chat".to_string();
    }

    // Take the first ~6 words
    let words: Vec<&str> = trimmed.split_whitespace().take(6).collect();
    let mut title = words.join(" ");

    // Cap at 50 characters
    if title.len() > 50 {
        // Find the last space before 50 chars to avoid cutting mid-word
        if let Some(pos) = title[..50].rfind(' ') {
            title.truncate(pos);
        } else {
            title.truncate(50);
        }
        title.push('…');
    }

    // Strip trailing punctuation (except ellipsis we just added)
    let stripped = title.trim_end_matches(|c: char| {
        c == '.' || c == ',' || c == '!' || c == '?' || c == ';' || c == ':'
    });

    let result = stripped.to_string();
    if result.is_empty() { "Chat".to_string() } else { result }
}

#[tauri::command]
pub async fn test_connection(
    api_key: String,
    model_url: String,
    model_name: String,
) -> Result<String, String> {
    let test_messages = vec![
        ("user".to_string(), "Say hello in one word.".to_string()),
    ];
    let reply = crate::ai::chat_completion(&api_key, &model_url, &model_name, test_messages)
        .await
        .map_err(|e| e.to_string())?;
    Ok(reply)
}

// ── Folders ──────────────────────────────────────────────────────────

/// Returns all folders ordered by position, with a live chat_count of non-archived, non-deleted chats.
#[tauri::command]
pub fn get_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT f.id, f.name, f.position, f.created_at, f.updated_at,
                COUNT(c.id) as chat_count
         FROM folders f
         LEFT JOIN chats c ON c.folder_id = f.id AND c.archived = 0 AND c.deleted_at IS NULL
         GROUP BY f.id
         ORDER BY f.position ASC, f.name ASC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map((), |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            position: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            chat_count: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut folders = Vec::new();
    for f in iter {
        folders.push(f.map_err(|e| e.to_string())?);
    }
    Ok(folders)
}

/// Returns lightweight previews (id, title, updated_at, last_user_message) for all non-archived chats in a folder.
#[tauri::command]
pub fn get_folder_chat_previews(folder_id: i64, state: State<'_, AppState>) -> Result<Vec<crate::models::FolderChatPreview>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT c.id, c.title, c.updated_at,
               (SELECT m.content FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' ORDER BY m.created_at DESC LIMIT 1) as preview_text
         FROM chats c
         WHERE c.folder_id = ?1 AND c.archived = 0 AND c.deleted_at IS NULL
         ORDER BY c.updated_at DESC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map([&folder_id], |row| {
        Ok(crate::models::FolderChatPreview {
            id: row.get(0)?,
            title: row.get(1)?,
            updated_at: row.get(2)?,
            preview_text: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut previews = Vec::new();
    for p in iter {
        previews.push(p.map_err(|e| e.to_string())?);
    }
    Ok(previews)
}

/// Creates a new folder. Position is set to max+1 so new folders appear at the bottom.
#[tauri::command]
pub fn create_folder(name: String, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    let max_pos: i64 = db
        .query_row("SELECT COALESCE(MAX(position), -1) FROM folders", (), |r| r.get(0))
        .unwrap_or(-1);

    db.execute(
        "INSERT INTO folders (name, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, max_pos + 1, now, now],
    ).map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

/// Renames a folder.
#[tauri::command]
pub fn rename_folder(id: i64, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;

    let changed = db.execute(
        "UPDATE folders SET name = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![name, now, id],
    ).map_err(|e| e.to_string())?;

    if changed == 0 {
        return Err(format!("Folder {} not found.", id));
    }
    Ok(())
}

/// Returns the count of active (non-archived, non-deleted) chats in a folder.
/// Used by the frontend before showing the deletion confirmation.
#[tauri::command]
pub fn get_folder_chat_count(folder_id: i64, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let count: i64 = db.query_row(
        "SELECT COUNT(*) FROM chats WHERE folder_id = ?1 AND archived = 0 AND deleted_at IS NULL",
        [&folder_id],
        |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(count)
}

/// Deletes a folder and sets folder_id = NULL on all its chats (move to No Folder).
/// The frontend must have already shown and confirmed the deletion dialog.
#[tauri::command]
pub fn delete_folder(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();

    // Nullify folder_id on all chats (archived or not — preserves assigned folder on re-archive)
    db.execute(
        "UPDATE chats SET folder_id = NULL WHERE folder_id = ?1",
        [&id],
    ).map_err(|e| e.to_string())?;

    db.execute("DELETE FROM folders WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Updates the position of a folder (used for future reordering support).
#[tauri::command]
pub fn move_folder(id: i64, position: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE folders SET position = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![position, now, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Moves a single chat into a folder (or NULL for No Folder).
#[tauri::command]
pub fn move_chat_to_folder(chat_id: i64, folder_id: Option<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE chats SET folder_id = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![folder_id, now, chat_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Find Empty Chat ───────────────────────────────────────────────────

/// Returns the id of the first unarchived, non-deleted, message-less "New Chat" if one exists.
#[tauri::command]
pub fn find_empty_chat(state: State<'_, AppState>) -> Result<Option<i64>, String> {
    let db = state.db.lock().unwrap();
    let result: Option<i64> = db.query_row(
        "SELECT id FROM chats
         WHERE title = 'New Chat'
           AND archived = 0
           AND deleted_at IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM messages WHERE messages.chat_id = chats.id
           )
         ORDER BY created_at DESC
         LIMIT 1",
        (),
        |row| row.get(0),
    ).ok();
    Ok(result)
}

// ── Bulk Chat Actions ─────────────────────────────────────────────────

/// Archives or unarchives multiple chats at once.
#[tauri::command]
pub fn bulk_archive_chats(ids: Vec<i64>, archived: bool, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    for id in &ids {
        db.execute(
            "UPDATE chats SET archived = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![archived, now, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Soft-deletes multiple chats (moves them to Trash).
#[tauri::command]
pub fn bulk_delete_chats(ids: Vec<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    for id in &ids {
        db.execute(
            "UPDATE chats SET deleted_at = ?1 WHERE id = ?2",
            rusqlite::params![now, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Moves multiple chats to a folder (NULL = No Folder).
#[tauri::command]
pub fn bulk_move_chats(ids: Vec<i64>, folder_id: Option<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    for id in &ids {
        db.execute(
            "UPDATE chats SET folder_id = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![folder_id, now, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Trash Commands ────────────────────────────────────────────────────

/// Returns all soft-deleted chats, sorted by deleted_at DESC (most recently trashed first).
#[tauri::command]
pub fn get_deleted_chats(state: State<'_, AppState>) -> Result<Vec<DeletedChat>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare(
        "SELECT id, title, deleted_at, folder_id
         FROM chats
         WHERE deleted_at IS NOT NULL
         ORDER BY deleted_at DESC"
    ).map_err(|e| e.to_string())?;

    let iter = stmt.query_map((), |row| {
        Ok(DeletedChat {
            id: row.get(0)?,
            title: row.get(1)?,
            deleted_at: row.get(2)?,
            folder_id: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut chats = Vec::new();
    for c in iter {
        chats.push(c.map_err(|e| e.to_string())?);
    }
    Ok(chats)
}

/// Restores one or more chats from Trash (sets deleted_at = NULL).
#[tauri::command]
pub fn restore_chats(ids: Vec<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    for id in &ids {
        db.execute(
            "UPDATE chats SET deleted_at = NULL WHERE id = ?1",
            [id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Permanently deletes one or more chats (with cascade to messages).
#[tauri::command]
pub fn delete_chats_permanently(ids: Vec<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    for id in &ids {
        db.execute("DELETE FROM chats WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs the retention purge on demand (same logic as startup purge).
#[tauri::command]
pub fn purge_expired_deleted_chats(state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    crate::db::purge_expired_deleted_chats(&db).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
pub struct EphemeralMsg {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn send_ephemeral_message(messages: Vec<EphemeralMsg>, state: State<'_, AppState>) -> Result<String, String> {
    let api_key: String = {
        let db = state.db.lock().unwrap();
        db.query_row("SELECT api_key FROM settings WHERE id = 1", (), |row| row.get(0)).map_err(|e| e.to_string())?
    };
    if api_key.trim().is_empty() {
        return Err("API key is not set".to_string());
    }

    let preset = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT model_url, model_name, customization_prompt FROM presets WHERE name LIKE '%Cubiquick%' LIMIT 1",
            (),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        ).ok()
    };

    let (model_url, model_name, customization_prompt) = match preset {
        Some(p) => p,
        None => {
            let db = state.db.lock().unwrap();
            let url: String = db.query_row("SELECT model_url FROM settings WHERE id = 1", (), |row| row.get(0)).unwrap_or_default();
            let model: String = db.query_row("SELECT model_name FROM settings WHERE id = 1", (), |row| row.get(0)).unwrap_or_default();
            (url, model, String::new())
        }
    };

    let mut conversation: Vec<(String, String)> = Vec::new();
    conversation.push(("system".to_string(), CUBIQ_IDENTITY_PROMPT.to_string()));
    if !customization_prompt.is_empty() {
        conversation.push(("system".to_string(), customization_prompt));
    }
    for m in messages {
        conversation.push((m.role, m.content));
    }

    crate::ai::chat_completion(&api_key, &model_url, &model_name, conversation)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        // Create the window if it doesn't exist
        let _ = tauri::WebviewWindowBuilder::new(
            &app_handle,
            "main",
            tauri::WebviewUrl::App("index.html".into())
        )
        .title("Cubiq")
        .inner_size(1100.0, 720.0)
        .min_inner_size(720.0, 500.0)
        .resizable(true)
        .maximized(true)
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

// Tray icon is set once at startup via JS matchMedia → set_tray_icon_mode.
// sync_quickask_theme is kept as a no-op so any stale frontend calls don't error.
#[tauri::command]
pub fn sync_quickask_theme(_app_handle: tauri::AppHandle, _app_theme: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn set_tray_icon_mode(app_handle: tauri::AppHandle, mode: String) -> Result<(), String> {
    crate::tray::set_tray_icon_from_mode(&app_handle, &mode).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_quickask_pinned(pinned: bool) {
    crate::tray::QUICKASK_PINNED.store(pinned, std::sync::atomic::Ordering::SeqCst);
}

// ── Streaming Commands ────────────────────────────────────────────────────

/// Start a streaming ephemeral chat (QuickAsk / Cubiquick).
/// No DB writes — everything is in-memory and emitted as events.
#[tauri::command]
pub async fn start_ephemeral_stream(
    messages: Vec<EphemeralMsg>,
    request_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    registry: State<'_, crate::streaming::StreamRegistry>,
) -> Result<(), String> {
    let api_key: String = {
        let db = state.db.lock().unwrap();
        db.query_row("SELECT api_key FROM settings WHERE id = 1", (), |row| row.get(0))
            .map_err(|e| e.to_string())?
    };
    if api_key.trim().is_empty() {
        return Err("API key is not set. Please add your Groq API key in Settings.".to_string());
    }

    let preset = {
        let db = state.db.lock().unwrap();
        db.query_row(
            "SELECT model_url, model_name, customization_prompt FROM presets WHERE name LIKE '%Cubiquick%' LIMIT 1",
            (),
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        ).ok()
    };

    let (model_url, model_name, customization_prompt) = match preset {
        Some(p) => p,
        None => {
            let db = state.db.lock().unwrap();
            let url: String = db.query_row("SELECT model_url FROM settings WHERE id = 1", (), |row| row.get(0)).unwrap_or_default();
            let model: String = db.query_row("SELECT model_name FROM settings WHERE id = 1", (), |row| row.get(0)).unwrap_or_default();
            (url, model, String::new())
        }
    };

    let mut conversation: Vec<(String, String)> = Vec::new();
    conversation.push(("system".to_string(), CUBIQ_IDENTITY_PROMPT.to_string()));
    if !customization_prompt.is_empty() {
        conversation.push(("system".to_string(), customization_prompt));
    }
    for m in messages {
        conversation.push((m.role, m.content));
    }

    let cancel_token = registry.register(&request_id);
    let rid = request_id.clone();

    let registry_inner = registry.inner().clone();

    tokio::spawn(async move {
        crate::streaming::run_stream(
            app_handle,
            "quickask".to_string(),
            rid.clone(),
            api_key,
            model_url,
            model_name,
            conversation,
            cancel_token,
        )
        .await;
        registry_inner.remove(&rid);
    });

    Ok(())
}

/// Start a streaming chat message for the main app.
/// Loads settings + chat snapshot from DB and streams to the "main" window.
#[tauri::command]
pub async fn start_chat_stream(
    chat_id: i64,
    request_id: String,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    registry: State<'_, crate::streaming::StreamRegistry>,
) -> Result<(), String> {
    // 1. Read API key
    let api_key: String = {
        let db = state.db.lock().unwrap();
        db.query_row("SELECT api_key FROM settings WHERE id = 1", (), |row| row.get(0))
            .map_err(|e| e.to_string())?
    };

    // 2. Read chat snapshot
    let (model_url, model_name, customization_prompt): (String, String, String) = {
        let db = state.db.lock().unwrap();
        let (snap_url, snap_model, snap_cust): (Option<String>, Option<String>, Option<String>) = db.query_row(
            "SELECT model_url_snapshot, model_name_snapshot, customization_snapshot FROM chats WHERE id = ?1",
            [&chat_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| e.to_string())?;

        if snap_url.is_some() && snap_model.is_some() {
            (snap_url.unwrap(), snap_model.unwrap(), snap_cust.unwrap_or_default())
        } else {
            let (url, model): (String, String) = db.query_row(
                "SELECT model_url, model_name FROM settings WHERE id = 1",
                (),
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|e| e.to_string())?;
            (url, model, String::new())
        }
    };

    // 3. Build conversation
    let mut conversation: Vec<(String, String)> = Vec::new();
    conversation.push(("system".to_string(), CUBIQ_IDENTITY_PROMPT.to_string()));
    if !customization_prompt.is_empty() {
        conversation.push(("system".to_string(), customization_prompt));
    }

    {
        let db = state.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT role, content FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&chat_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (role, content) = row.map_err(|e| e.to_string())?;
            conversation.push((role, content));
        }
    }

    let cancel_token = registry.register(&request_id);
    let rid = request_id.clone();

    let registry_inner = registry.inner().clone();

    tokio::spawn(async move {
        crate::streaming::run_stream(
            app_handle,
            "main".to_string(),
            rid.clone(),
            api_key,
            model_url,
            model_name,
            conversation,
            cancel_token,
        )
        .await;
        registry_inner.remove(&rid);
    });

    Ok(())
}

/// Finalize a chat stream: persist the assistant message and trigger auto-title.
/// Called by the frontend when stream_done is received.
#[tauri::command]
pub async fn finalize_chat_stream(
    chat_id: i64,
    _request_id: String,
    full_content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if full_content.trim().is_empty() {
        return Ok(()); // Don't persist empty responses
    }

    // 1. Insert assistant message
    let first_user_message: Option<String>;
    {
        let db = state.db.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;

        db.execute(
            "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            (&chat_id, &"assistant", &full_content, &now),
        )
        .map_err(|e| e.to_string())?;

        db.execute(
            "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
            (&now, &chat_id),
        )
        .map_err(|e| e.to_string())?;

        // Read first user message for auto-title
        first_user_message = db.query_row(
            "SELECT content FROM messages WHERE chat_id = ?1 AND role = 'user' ORDER BY created_at ASC LIMIT 1",
            [&chat_id],
            |row| row.get(0),
        ).ok();
    }

    // 2. Auto-title if needed
    let should_auto_title = {
        let db = state.db.lock().unwrap();
        let (title, user_edited): (String, bool) = db.query_row(
            "SELECT title, user_edited_title FROM chats WHERE id = ?1",
            [&chat_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap_or(("".to_string(), true));
        !user_edited && title == "New Chat"
    };

    if should_auto_title {
        if let Some(ref user_msg) = first_user_message {
            // Read API settings for title generation
            let (api_key, model_url, model_name) = {
                let db = state.db.lock().unwrap();
                let key: String = db.query_row("SELECT api_key FROM settings WHERE id = 1", (), |row| row.get(0)).unwrap_or_default();

                let (snap_url, snap_model): (Option<String>, Option<String>) = db.query_row(
                    "SELECT model_url_snapshot, model_name_snapshot FROM chats WHERE id = ?1",
                    [&chat_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                ).unwrap_or((None, None));

                if snap_url.is_some() && snap_model.is_some() {
                    (key, snap_url.unwrap(), snap_model.unwrap())
                } else {
                    let (url, model): (String, String) = db.query_row(
                        "SELECT model_url, model_name FROM settings WHERE id = 1",
                        (),
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    ).unwrap_or_default();
                    (key, url, model)
                }
            };

            let title = try_generate_ai_title(&api_key, &model_url, &model_name, user_msg)
                .await
                .unwrap_or_else(|_| generate_fallback_title(user_msg));

            let db = state.db.lock().unwrap();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64;
            let _ = db.execute(
                "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3 AND user_edited_title = 0",
                (&title, &now, &chat_id),
            );
        }
    }

    Ok(())
}

/// Cancel an active stream by request_id.
#[tauri::command]
pub fn cancel_stream(
    request_id: String,
    registry: State<'_, crate::streaming::StreamRegistry>,
) -> Result<(), String> {
    registry.cancel(&request_id);
    Ok(())
}
