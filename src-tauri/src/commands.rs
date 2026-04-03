use rusqlite::Connection;
use std::sync::Mutex;
use tauri::State;
use crate::models::{Chat, Message, Settings};

pub struct AppState {
    pub db: Mutex<Connection>,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT theme, api_key, model_url, model_name FROM settings WHERE id = 1").map_err(|e| e.to_string())?;
    
    let settings = stmt.query_row((), |row| {
        Ok(Settings {
            theme: row.get(0)?,
            api_key: row.get(1)?,
            model_url: row.get(2)?,
            model_name: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    
    Ok(settings)
}

#[tauri::command]
pub fn update_settings(settings: Settings, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "UPDATE settings SET theme = ?1, api_key = ?2, model_url = ?3, model_name = ?4 WHERE id = 1",
        (&settings.theme, &settings.api_key, &settings.model_url, &settings.model_name),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_chats(state: State<'_, AppState>) -> Result<Vec<Chat>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT id, title, created_at, updated_at, archived FROM chats ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    
    let chat_iter = stmt.query_map((), |row| {
        Ok(Chat {
            id: row.get(0)?,
            title: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            archived: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut chats = Vec::new();
    for chat in chat_iter {
        chats.push(chat.map_err(|e| e.to_string())?);
    }
    
    Ok(chats)
}

#[tauri::command]
pub fn create_chat(title: String, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    
    db.execute(
        "INSERT INTO chats (title, created_at, updated_at, archived) VALUES (?1, ?2, ?3, 0)",
        (&title, &now, &now),
    ).map_err(|e| e.to_string())?;
    
    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub fn rename_chat(id: i64, title: String, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
    db.execute(
        "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3",
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

#[tauri::command]
pub fn delete_chat(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM chats WHERE id = ?1", [&id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_messages(chat_id: i64, state: State<'_, AppState>) -> Result<Vec<Message>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT id, chat_id, role, content, created_at FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    
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
    
    // Update chat last updated
    db.execute(
        "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
        (&now, &chat_id),
    ).map_err(|e| e.to_string())?;

    Ok(db.last_insert_rowid())
}

#[tauri::command]
pub async fn send_chat_message(chat_id: i64, state: State<'_, AppState>) -> Result<String, String> {
    // 1. Read settings (api key, model url, model name)
    let (api_key, model_url, model_name) = {
        let db = state.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT api_key, model_url, model_name FROM settings WHERE id = 1")
            .map_err(|e| e.to_string())?;
        stmt.query_row((), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
    };

    // 2. Build conversation history from all messages in this chat
    let conversation: Vec<(String, String)> = {
        let db = state.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT role, content FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([&chat_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut msgs = Vec::new();
        for row in rows {
            msgs.push(row.map_err(|e| e.to_string())?);
        }
        msgs
    };

    // 3. Call the AI service
    let reply = crate::ai::chat_completion(&api_key, &model_url, &model_name, conversation)
        .await
        .map_err(|e| e.to_string())?;

    // 4. Persist the assistant reply
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

    Ok(reply)
}

#[tauri::command]
pub async fn test_connection(
    api_key: String,
    model_url: String,
    model_name: String,
) -> Result<String, String> {
    // Send a minimal chat completion to validate the connection
    let test_messages = vec![
        ("user".to_string(), "Say hello in one word.".to_string()),
    ];
    let reply = crate::ai::chat_completion(&api_key, &model_url, &model_name, test_messages)
        .await
        .map_err(|e| e.to_string())?;
    Ok(reply)
}
