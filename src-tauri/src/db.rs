use rusqlite::{Connection, Result, params};
use std::fs;
use std::path::PathBuf;

/// Built-in preset definitions used during migration seeding.
struct BuiltinPreset {
    name: &'static str,
    model_url: &'static str,
    model_name: &'static str,
    customization_prompt: &'static str,
}

const BUILTIN_PRESETS: &[BuiltinPreset] = &[
    BuiltinPreset {
        name: "Cubiq Default",
        model_url: "https://api.groq.com/openai/v1",
        model_name: "llama-3.3-70b-versatile",
        customization_prompt: "You are Cubiq, the AI assistant inside the Cubiq desktop app. Be helpful, clear, and concise. When asked who you are, identify yourself as Cubiq. Do not identify yourself as ChatGPT, Meta AI, Claude, Gemini, or any other assistant brand.",
    },
    BuiltinPreset {
        name: "Cubiquick",
        model_url: "https://api.groq.com/openai/v1",
        model_name: "llama-3.3-70b-versatile",
        customization_prompt: "You are Cubiq. Give the shortest correct answer possible. Skip greetings, preambles, filler, and explanations unless the user asks for them. Be direct and efficient.",
    },
    BuiltinPreset {
        name: "Cubiq Research",
        model_url: "https://api.groq.com/openai/v1",
        model_name: "llama-3.3-70b-versatile",
        customization_prompt: "You are Cubiq in research mode. Provide thorough, well-structured, careful answers. Break down complex topics clearly, explain reasoning step by step, and cite sources when appropriate. Prefer nuance and completeness over brevity.",
    },
    BuiltinPreset {
        name: "Cubiq Programming",
        model_url: "https://api.groq.com/openai/v1",
        model_name: "llama-3.3-70b-versatile",
        customization_prompt: "You are Cubiq in programming mode. Be an expert software engineering assistant. Provide clean, practical, modern solutions with clear explanations. Prefer best practices, readable code, and useful debugging guidance. Use code examples when they help.",
    },
];

pub fn init_db(app_dir: PathBuf) -> Result<Connection> {
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| {
            rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_IOERR),
                Some(format!("Failed to create app data directory: {}", e)),
            )
        })?;
    }

    let db_path = app_dir.join("cubiq.db");
    let conn = Connection::open(db_path)?;

    conn.execute("PRAGMA foreign_keys = ON", ())?;

    // ── Create base tables (original schema, IF NOT EXISTS) ──────────
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            archived BOOLEAN NOT NULL DEFAULT 0
        )",
        (),
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )",
        (),
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            theme TEXT NOT NULL,
            api_key TEXT NOT NULL,
            model_url TEXT NOT NULL,
            model_name TEXT NOT NULL
        )",
        (),
    )?;

    // Insert default settings if absent (original defaults)
    conn.execute(
        "INSERT OR IGNORE INTO settings (id, theme, api_key, model_url, model_name)
         VALUES (1, 'system', '', 'https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile')",
        (),
    )?;

    // ── Schema versioning & migrations ────────────────────────────────
    let version: i32 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;

    if version < 1 {
        migrate_v0_to_v1(&conn)?;
        conn.pragma_update(None, "user_version", 1)?;
    }
    
    if version < 2 {
        migrate_v1_to_v2(&conn)?;
        conn.pragma_update(None, "user_version", 2)?;
    }

    if version < 3 {
        migrate_v2_to_v3(&conn)?;
        conn.pragma_update(None, "user_version", 3)?;
    }

    if version < 4 {
        migrate_v3_to_v4(&conn)?;
        conn.pragma_update(None, "user_version", 4)?;
    }

    // Purge expired soft-deleted chats on every startup
    purge_expired_deleted_chats(&conn)?;

    Ok(conn)
}

/// Migration from v0 (original schema) to v1 (presets + chat snapshots + accent theme).
///
/// All steps run in a single transaction for atomicity.
fn migrate_v0_to_v1(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // ── 1. Create presets table ──────────────────────────────────────
    tx.execute(
        "CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            model_url TEXT NOT NULL,
            model_name TEXT NOT NULL,
            custom_model_name TEXT,
            customization_prompt TEXT NOT NULL DEFAULT '',
            is_builtin BOOLEAN NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        (),
    )?;

    // ── 2. Seed built-in presets ─────────────────────────────────────
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    for preset in BUILTIN_PRESETS {
        tx.execute(
            "INSERT INTO presets (name, model_url, model_name, custom_model_name, customization_prompt, is_builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, NULL, ?4, 1, ?5, ?6)",
            params![preset.name, preset.model_url, preset.model_name, preset.customization_prompt, now, now],
        )?;
    }

    // Get the Cubiq Default preset id for backfill
    let default_preset_id: i64 = tx.query_row(
        "SELECT id FROM presets WHERE name = 'Cubiq Default' AND is_builtin = 1",
        (),
        |row| row.get(0),
    )?;

    // Get the Cubiq Default customization prompt for snapshot backfill
    let default_customization: String = tx.query_row(
        "SELECT customization_prompt FROM presets WHERE id = ?1",
        [&default_preset_id],
        |row| row.get(0),
    )?;

    // ── 3. ALTER chats — add 7 new columns ──────────────────────────
    // Using separate ALTERs because SQLite requires one column per ALTER
    tx.execute("ALTER TABLE chats ADD COLUMN preset_id INTEGER", ())?;
    tx.execute("ALTER TABLE chats ADD COLUMN preset_name_snapshot TEXT", ())?;
    tx.execute("ALTER TABLE chats ADD COLUMN model_url_snapshot TEXT", ())?;
    tx.execute("ALTER TABLE chats ADD COLUMN model_name_snapshot TEXT", ())?;
    tx.execute("ALTER TABLE chats ADD COLUMN customization_snapshot TEXT", ())?;
    tx.execute("ALTER TABLE chats ADD COLUMN preset_locked BOOLEAN NOT NULL DEFAULT 0", ())?;
    tx.execute("ALTER TABLE chats ADD COLUMN user_edited_title BOOLEAN NOT NULL DEFAULT 0", ())?;

    // ── 4. ALTER settings — add 2 new columns ───────────────────────
    tx.execute("ALTER TABLE settings ADD COLUMN accent_theme TEXT NOT NULL DEFAULT 'emerald'", ())?;
    tx.execute("ALTER TABLE settings ADD COLUMN selected_preset_id INTEGER", ())?;

    // ── 5. Backfill existing chats ──────────────────────────────────
    // Read current settings model_url and model_name for snapshot backfill
    let (legacy_model_url, legacy_model_name): (String, String) = tx.query_row(
        "SELECT model_url, model_name FROM settings WHERE id = 1",
        (),
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    tx.execute(
        "UPDATE chats SET
            preset_id = ?1,
            preset_name_snapshot = 'Cubiq Default',
            model_url_snapshot = ?2,
            model_name_snapshot = ?3,
            customization_snapshot = ?4,
            preset_locked = 1,
            user_edited_title = 0
         WHERE preset_id IS NULL",
        params![default_preset_id, legacy_model_url, legacy_model_name, default_customization],
    )?;

    // ── 6. Set default preset in settings ───────────────────────────
    tx.execute(
        "UPDATE settings SET selected_preset_id = ?1 WHERE id = 1",
        [&default_preset_id],
    )?;

    tx.commit()?;
    Ok(())
}

/// Migration from v1 (presets/accent_theme) to v2 (full app_theme).
fn migrate_v1_to_v2(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Add app_theme column, default to 'cubiq-dark'
    tx.execute("ALTER TABLE settings ADD COLUMN app_theme TEXT NOT NULL DEFAULT 'cubiq-dark'", ())?;

    tx.commit()?;
    Ok(())
}

/// Migration from v2 (app_theme) to v3 (folders + chat.folder_id).
///
/// - Creates the `folders` table.
/// - Adds `folder_id` to `chats` (nullable, defaults to NULL = ungrouped).
/// - All existing chats keep folder_id = NULL and remain in "No Folder".
fn migrate_v2_to_v3(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // ── 1. Create folders table ──────────────────────────────────────
    tx.execute(
        "CREATE TABLE IF NOT EXISTS folders (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            position   INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        (),
    )?;

    // ── 2. Add folder_id to chats ────────────────────────────────────
    // NULL = ungrouped (No Folder). Foreign key enforced at application level
    // since SQLite ALTER TABLE cannot add FK constraints directly.
    // ON DELETE SET NULL behaviour is handled in the delete_folder command.
    tx.execute(
        "ALTER TABLE chats ADD COLUMN folder_id INTEGER",
        (),
    )?;

    tx.commit()?;
    Ok(())
}

/// Migration from v3 (folders) to v4 (soft-delete + trash retention).
///
/// - Adds `deleted_at` to `chats` (NULL = live, non-null = in trash).
/// - Adds `trash_retention_days` to `settings` (default 7).
fn migrate_v3_to_v4(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // 1. Soft-delete column on chats
    tx.execute("ALTER TABLE chats ADD COLUMN deleted_at INTEGER", ())?;

    // 2. Retention setting
    tx.execute("ALTER TABLE settings ADD COLUMN trash_retention_days INTEGER NOT NULL DEFAULT 7", ())?;

    tx.commit()?;
    Ok(())
}

/// Permanently deletes chats whose `deleted_at` is older than `trash_retention_days`.
/// Called on every app startup so the trash self-cleans.
pub fn purge_expired_deleted_chats(conn: &Connection) -> Result<()> {
    let retention_days: i64 = conn.query_row(
        "SELECT trash_retention_days FROM settings WHERE id = 1",
        (),
        |r| r.get(0),
    ).unwrap_or(7);

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    let cutoff_ms = now_ms - retention_days * 86_400_000;

    conn.execute(
        "DELETE FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        [cutoff_ms],
    )?;

    Ok(())
}
