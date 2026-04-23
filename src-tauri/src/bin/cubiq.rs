use clap::{Parser, Subcommand, Args};
use directories::BaseDirs;
use is_terminal::IsTerminal;
use rusqlite::{Connection, params};
use std::io::{self, stdout, Write};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use reqwest::Client;
use futures_util::StreamExt;

use std::sync::{Mutex, OnceLock};

// Bring in logic from our tauri app
use cubiq_lib::models::Settings;
use cubiq_lib::db::init_db;
use cubiq_lib::ai;

static EPHEMERAL_HISTORY: OnceLock<Mutex<Vec<(String, String)>>> = OnceLock::new();


fn write_text(text: &str, is_tty: bool) -> io::Result<()> {
    let mut out = io::stdout();

    #[cfg(windows)]
    {
        if !is_tty {
            out.write_all(&[0xFF, 0xFE])?;
            for u in text.encode_utf16() {
                out.write_all(&u.to_le_bytes())?;
            }
            out.flush()?;
            return Ok(());
        }
    }

    out.write_all(text.as_bytes())?;
    out.flush()?;
    Ok(())
}

fn print_result(text: &str) {
    let is_tty = io::stdout().is_terminal();
    let _ = write_text(&format!("{}\n", text), is_tty);
}

#[derive(Parser)]
#[command(name = "cubiq", version = "0.1.0", about = "Cubiq CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
    /// Skip confirmation prompts
    #[arg(long, short, global = true)]
    yes: bool,
}

#[derive(Args, Clone)]
#[group(required = true, multiple = false)]
struct TargetArgs {
    /// Target by ID
    #[arg(long)]
    id: Option<i64>,
    /// Target by Name (case-insensitive)
    #[arg(long)]
    name: Option<String>,
    /// Target by ID or Name (digits-only = ID-first)
    #[arg(index = 1)]
    query: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Show current status (active workspace, chat, preset, model)
    Status,
    /// Print path-like location (e.g. workspaces/<name>/<chat>)
    Where,
    /// Ask a question. Interactive REPL session with ephemeral memory.
    Ask {
        /// Optional first prompt. If omitted, starts REPL immediately.
        prompt: Option<String>,
        /// Single-shot stateless request (no REPL, no memory).
        #[arg(long)]
        once: bool,
        /// Override preset for this request
        #[arg(long)]
        preset: Option<String>,
        /// Disable streaming
        #[arg(long)]
        no_stream: bool,
        /// Force streaming (even if not TTY)
        #[arg(long)]
        stream: bool,
    },
    /// Send a message to the active persistent chat.
    Send {
        message: String,
        /// Disable streaming
        #[arg(long)]
        no_stream: bool,
        /// Force streaming (even if not TTY)
        #[arg(long)]
        stream: bool,
    },
    /// Clear the active chat context
    Close,
    /// Create a new persistent chat
    New {
        /// Optional explicit title
        #[arg(long)]
        title: Option<String>,
        /// Optional workspace name to create the chat in
        #[arg(long)]
        workspace: Option<String>,
        /// Optional preset name or ID to associate
        #[arg(long)]
        preset: Option<String>,
    },
    /// Navigate to a chat or workspace
    Open {
        #[command(subcommand)]
        target: OpenTarget,
    },
    /// Switch the default preset
    Preset {
        name: String,
    },
    /// List chats, workspaces, archived, deleted
    List {
        #[command(subcommand)]
        target: ListTarget,
    },
    /// Delete a chat (soft delete or permanent)
    Delete {
        #[command(subcommand)]
        target: DeleteTarget,
    },
    /// Restore a chat from trash
    Restore {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// Archive a chat
    Archive {
        #[command(flatten)]
        target: TargetArgs,
    },
    /// Unarchive a chat
    Unarchive {
        #[command(flatten)]
        target: TargetArgs,
    },
}

#[derive(Subcommand)]
enum OpenTarget {
    /// Open a chat
    Chats { 
        #[command(flatten)]
        target: TargetArgs 
    },
    /// Open a workspace (folder)
    Workspaces { 
        workspace: String,
        /// Optional chat within the workspace
        query: Option<String>
    },
    /// Go back to the last active chat
    #[command(name = "..")]
    Back,
}

#[derive(Subcommand)]
enum DeleteTarget {
    /// Delete an active chat
    Chats { 
        #[command(flatten)]
        target: TargetArgs 
    },
    /// Delete a chat from a workspace
    Workspaces { 
        workspace: String, 
        query: String 
    },
    /// Delete an archived chat
    Archived { 
        #[command(flatten)]
        target: TargetArgs 
    },
    /// Permanently delete from trash
    Deleted { 
        #[command(flatten)]
        target: TargetArgs 
    },
}

#[derive(Subcommand)]
enum ListTarget {
    /// List active chats
    Chats,
    /// List all workspaces
    Workspaces,
    /// List archived chats
    Archived,
    /// List deleted chats (trash)
    Deleted,
}

fn get_app_data_dir() -> PathBuf {
    let base_dirs = BaseDirs::new().expect("Failed to get base directories");
    base_dirs.data_dir().join("com.cubiq.app")
}

fn open_db() -> rusqlite::Result<Connection> {
    let app_dir = get_app_data_dir();
    init_db(app_dir)
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Status => handle_status(),
        Commands::Where => handle_where(),
        Commands::Ask {
            prompt,
            once,
            preset,
            no_stream,
            stream,
        } => {
            let mut do_stream = std::io::stdout().is_terminal();
            if *no_stream {
                do_stream = false;
            }
            if *stream {
                do_stream = true;
            }
            handle_ask(prompt.as_deref(), *once, preset.as_deref(), do_stream).await;
        }
        Commands::Send {
            message,
            no_stream,
            stream,
        } => {
            let mut do_stream = std::io::stdout().is_terminal();
            if *no_stream {
                do_stream = false;
            }
            if *stream {
                do_stream = true;
            }
            handle_send(message, do_stream).await;
        }
        Commands::Close => handle_close(),
        Commands::New { title, workspace, preset } => handle_new(title.as_deref(), workspace.as_deref(), preset.as_deref()),
        Commands::Open { target } => handle_open(target),
        Commands::Preset { name } => handle_preset(name),
        Commands::List { target } => handle_list(target),
        Commands::Delete { target } => handle_delete(target, cli.yes),
        Commands::Restore { target } => handle_restore(target, cli.yes),
        Commands::Archive { target } => handle_archive(target, cli.yes),
        Commands::Unarchive { target } => handle_unarchive(target, cli.yes),
    }
}

fn handle_preset(name: &str) {
    let conn = open_db().expect("Failed to open DB");
    let preset_id: Option<i64> = conn.query_row("SELECT id FROM presets WHERE name = ?1 COLLATE NOCASE LIMIT 1", [name], |r| r.get(0)).ok();
    
    let mut output = String::new();
    if let Some(id) = preset_id {
        conn.execute("UPDATE settings SET selected_preset_id = ?1 WHERE id = 1", [id]).unwrap();
        output.push_str(&format!("Default preset set to '{}' (ID: {})\n", name, id));
    } else {
        eprintln!("Preset not found: {}", name);
        output.push_str("Available presets:\n");
        let mut stmt = conn.prepare("SELECT name FROM presets").unwrap();
        let rows = stmt.query_map((), |r| r.get::<_, String>(0)).unwrap();
        for row in rows {
            if let Ok(n) = row {
                output.push_str(&format!("- {}\n", n));
            }
        }
    }
    let is_tty = io::stdout().is_terminal();
    let _ = write_text(&output, is_tty);
}

fn handle_status() {
    let conn = match open_db() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Error opening database: {}", e);
            return;
        }
    };

    let settings: Settings = match conn.query_row(
        "SELECT app_theme, theme, accent_theme, api_key, model_url, model_name, selected_preset_id, trash_retention_days, active_chat_id, active_folder_id, last_chat_id, cli_preset_id FROM settings WHERE id = 1",
        (),
        |r| {
            Ok(Settings {
                app_theme: r.get(0)?,
                theme: r.get(1)?,
                accent_theme: r.get(2)?,
                api_key: r.get(3)?,
                model_url: r.get(4)?,
                model_name: r.get(5)?,
                selected_preset_id: r.get(6)?,
                trash_retention_days: r.get(7)?,
                active_chat_id: r.get(8)?,
                active_folder_id: r.get(9)?,
                last_chat_id: r.get(10)?,
                cli_preset_id: r.get(11)?,
                ..Default::default()
            })
        },
    ) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to read settings: {}", e);
            return;
        }
    };

    let mut output = String::new();
    output.push_str(&format!("Model: {} ({})\n", settings.model_name, settings.model_url));
    if let Some(chat_id) = settings.active_chat_id {
        if let Ok(title) = conn.query_row("SELECT title FROM chats WHERE id = ?1", [chat_id], |r| r.get::<_, String>(0)) {
            output.push_str(&format!("Active Chat: {} (ID: {})\n", title, chat_id));
        } else {
            output.push_str(&format!("Active Chat: Unknown (ID: {})\n", chat_id));
        }
    } else {
        output.push_str("Active Chat: None\n");
    }
    if let Some(folder_id) = settings.active_folder_id {
        if let Ok(name) = conn.query_row("SELECT name FROM folders WHERE id = ?1", [folder_id], |r| r.get::<_, String>(0)) {
            output.push_str(&format!("Active Workspace: {} (ID: {})\n", name, folder_id));
        } else {
            output.push_str(&format!("Active Workspace: Unknown (ID: {})\n", folder_id));
        }
    } else {
        output.push_str("Active Workspace: None\n");
    }
    let is_tty = io::stdout().is_terminal();
    let _ = write_text(&output, is_tty);
}

fn handle_where() {
    let conn = open_db().expect("Failed to open DB");
    let active_chat_id: Option<i64> = conn.query_row("SELECT active_chat_id FROM settings WHERE id = 1", (), |r| r.get(0)).unwrap_or(None);
    
    let mut output = String::new();
    if let Some(chat_id) = active_chat_id {
        let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [chat_id], |r| r.get(0)).unwrap_or_else(|_| "Unknown".to_string());
        let folder_id: Option<i64> = conn.query_row("SELECT folder_id FROM chats WHERE id = ?1", [chat_id], |r| r.get(0)).unwrap_or(None);
        if let Some(fid) = folder_id {
            let fname: String = conn.query_row("SELECT name FROM folders WHERE id = ?1", [fid], |r| r.get(0)).unwrap_or_else(|_| "Unknown".to_string());
            output.push_str(&format!("workspaces/{}/{}\n", fname, title));
        } else {
            output.push_str(&format!("chats/{}\n", title));
        }
    } else {
        output.push_str("/\n");
    }
    let is_tty = io::stdout().is_terminal();
    let _ = write_text(&output, is_tty);
}

fn handle_list(target: &ListTarget) {
    let conn = open_db().expect("Failed to open DB");
    let mut found = false;
    let mut output = String::new();
    
    match target {
        ListTarget::Workspaces => {
            let mut stmt = conn.prepare("SELECT id, name FROM folders ORDER BY position").unwrap();
            let rows = stmt.query_map((), |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).unwrap();
            for row in rows {
                if let Ok((id, name)) = row {
                    output.push_str(&format!("[Workspace {}] {}\n", id, name));
                    found = true;
                }
            }
            if !found { output.push_str("No workspaces found.\n"); }
        }
        ListTarget::Deleted => {
            let mut stmt = conn.prepare("SELECT id, title FROM chats WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").unwrap();
            let rows = stmt.query_map((), |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).unwrap();
            for row in rows {
                if let Ok((id, title)) = row {
                    output.push_str(&format!("[Chat {}] {} (Deleted)\n", id, title));
                    found = true;
                }
            }
            if !found { output.push_str("Trash is empty.\n"); }
        }
        ListTarget::Archived => {
            let mut stmt = conn.prepare("SELECT id, title, folder_id FROM chats WHERE archived = 1 AND deleted_at IS NULL ORDER BY updated_at DESC").unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<i64>>(2)?))).unwrap();
            for row in rows {
                if let Ok((id, title, folder_id)) = row {
                    found = true;
                    if let Some(fid) = folder_id {
                        let fname: String = conn.query_row("SELECT name FROM folders WHERE id = ?1", [fid], |r| r.get(0)).unwrap_or_else(|_| "Unknown".to_string());
                        output.push_str(&format!("[Chat {}] {} (Workspace: {})\n", id, title, fname));
                    } else {
                        output.push_str(&format!("[Chat {}] {}\n", id, title));
                    }
                }
            }
            if !found { output.push_str("No archived chats.\n"); }
        }
        ListTarget::Chats => {
            let mut stmt = conn.prepare("SELECT id, title, folder_id FROM chats WHERE archived = 0 AND deleted_at IS NULL ORDER BY updated_at DESC").unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<i64>>(2)?))).unwrap();
            for row in rows {
                if let Ok((id, title, folder_id)) = row {
                    found = true;
                    if let Some(fid) = folder_id {
                        let fname: String = conn.query_row("SELECT name FROM folders WHERE id = ?1", [fid], |r| r.get(0)).unwrap_or_else(|_| "Unknown".to_string());
                        output.push_str(&format!("[Chat {}] {} (Workspace: {})\n", id, title, fname));
                    } else {
                        output.push_str(&format!("[Chat {}] {}\n", id, title));
                    }
                }
            }
            if !found { output.push_str("No chats found.\n"); }
        }
    }
    let is_tty = io::stdout().is_terminal();
    let _ = write_text(&output, is_tty);
}

/// Disambiguation rule implementation
fn resolve_chat(conn: &Connection, args: &TargetArgs, scope_sql: &str) -> Option<i64> {
    if let Some(id) = args.id {
        // Force ID lookup
        let exists: bool = conn.query_row(&format!("SELECT 1 FROM chats WHERE id = ?1 AND ({})", scope_sql), [id], |_| Ok(true)).unwrap_or(false);
        return if exists { Some(id) } else { None };
    }
    
    if let Some(name) = &args.name {
        // Force Name lookup
        return resolve_by_name(conn, name, scope_sql);
    }
    
    if let Some(query) = &args.query {
        // Digits-only rule
        if query.chars().all(|c| c.is_ascii_digit()) {
            let id = query.parse::<i64>().unwrap();
            let exists: bool = conn.query_row(&format!("SELECT 1 FROM chats WHERE id = ?1 AND ({})", scope_sql), [id], |_| Ok(true)).unwrap_or(false);
            if exists {
                return Some(id);
            }
        }
        // Fallback or non-digits => name search
        return resolve_by_name(conn, query, scope_sql);
    }
    
    None
}

fn resolve_by_name(conn: &Connection, query: &str, scope_sql: &str) -> Option<i64> {
    // 1. Exact case-insensitive match
    let exact_match: Option<i64> = conn.query_row(
        &format!("SELECT id FROM chats WHERE title = ?1 COLLATE NOCASE AND ({}) LIMIT 2", scope_sql),
        [query],
        |r| r.get(0)
    ).ok();
    
    if exact_match.is_some() {
        // Check if there are multiple exact matches (rare but possible)
        let count: i64 = conn.query_row(
            &format!("SELECT count(*) FROM chats WHERE title = ?1 COLLATE NOCASE AND ({})", scope_sql),
            [query],
            |r| r.get(0)
        ).unwrap_or(0);
        
        if count > 1 {
            handle_ambiguity(conn, query, scope_sql);
        }
        return exact_match;
    }
    
    // 2. Partial match
    let mut stmt = conn.prepare(&format!("SELECT id, title FROM chats WHERE title LIKE ?1 AND ({})", scope_sql)).unwrap();
    let rows: Vec<(i64, String)> = stmt.query_map([format!("%{}%", query)], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|r| r.ok()).collect();
    
    if rows.is_empty() {
        return None;
    }
    
    if rows.len() > 1 {
        handle_ambiguity_from_rows(rows, query);
    }
    
    Some(rows[0].0)
}

fn handle_ambiguity(conn: &Connection, query: &str, scope_sql: &str) -> ! {
    let mut stmt = conn.prepare(&format!("SELECT id, title FROM chats WHERE title LIKE ?1 AND ({})", scope_sql)).unwrap();
    let rows: Vec<(i64, String)> = stmt.query_map([format!("%{}%", query)], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().filter_map(|r| r.ok()).collect();
    handle_ambiguity_from_rows(rows, query);
}

fn handle_ambiguity_from_rows(rows: Vec<(i64, String)>, query: &str) -> ! {
    eprintln!("Multiple chats found matching '{}':", query);
    for (id, title) in rows {
        eprintln!("  [{}] {}", id, title);
    }
    eprintln!("Please specify the exact Chat ID using --id <N> or a more specific name.");
    std::process::exit(1);
}

fn handle_open(target: &OpenTarget) {
    let conn = open_db().expect("Failed to open DB");
    match target {
        OpenTarget::Chats { target } => {
            if let Some(id) = resolve_chat(&conn, target, "deleted_at IS NULL") {
                let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).unwrap();
                conn.execute("UPDATE settings SET active_chat_id = ?1, last_chat_id = ?1, active_folder_id = (SELECT folder_id FROM chats WHERE id = ?1) WHERE id = 1", [id]).unwrap();
                print_result(&format!("Opened chat: {} (ID: {})", title, id));
            } else {
                eprintln!("Chat not found.");
            }
        }
        OpenTarget::Workspaces { workspace, query } => {
            let folder_id: Option<i64> = if workspace.chars().all(|c| c.is_ascii_digit()) {
                let id = workspace.parse::<i64>().unwrap();
                let exists: bool = conn.query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |_| Ok(true)).unwrap_or(false);
                if exists { Some(id) } else { None }
            } else {
                conn.query_row("SELECT id FROM folders WHERE name = ?1 COLLATE NOCASE LIMIT 1", [workspace], |r| r.get(0)).ok()
            };
            
            if let Some(fid) = folder_id {
                let fname: String = conn.query_row("SELECT name FROM folders WHERE id = ?1", [fid], |r| r.get(0)).unwrap();
                if let Some(chat_query) = query {
                    let targs = TargetArgs { id: None, name: None, query: Some(chat_query.clone()) };
                    if let Some(cid) = resolve_chat(&conn, &targs, &format!("folder_id = {} AND deleted_at IS NULL", fid)) {
                        conn.execute("UPDATE settings SET active_chat_id = ?1, last_chat_id = ?1, active_folder_id = ?2 WHERE id = 1", (cid, fid)).unwrap();
                        let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [cid], |r| r.get(0)).unwrap();
                        print_result(&format!("Opened workspace: {} (ID: {}), chat: {} (ID: {})", fname, fid, title, cid));
                    } else {
                        eprintln!("Chat '{}' not found in workspace '{}'.", chat_query, fname);
                    }
                } else {
                    conn.execute("UPDATE settings SET active_folder_id = ?1, active_chat_id = NULL WHERE id = 1", [fid]).unwrap();
                    print_result(&format!("Opened workspace: {} (ID: {})", fname, fid));
                }
            } else {
                eprintln!("Workspace not found: {}", workspace);
            }
        }
        OpenTarget::Back => {
            let last_id: Option<i64> = conn.query_row("SELECT last_chat_id FROM settings WHERE id = 1", (), |r| r.get(0)).unwrap_or(None);
            if let Some(id) = last_id {
                let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_else(|_| "Unknown".to_string());
                conn.execute("UPDATE settings SET active_chat_id = ?1 WHERE id = 1", [id]).unwrap();
                print_result(&format!("Opened chat: {} (ID: {})", title, id));
            } else {
                eprintln!("No previous chat to go back to.");
            }
        }
    }
}

fn handle_delete(target: &DeleteTarget, yes: bool) {
    let conn = open_db().expect("Failed to open DB");
    
    let (chat_id, is_perma) = match target {
        DeleteTarget::Chats { target } => (resolve_chat(&conn, target, "deleted_at IS NULL"), false),
        DeleteTarget::Workspaces { workspace, query } => {
            let fid: Option<i64> = workspace.parse().ok().or_else(|| conn.query_row("SELECT id FROM folders WHERE name = ?1 COLLATE NOCASE", [workspace], |r| r.get(0)).ok());
            if let Some(fid) = fid {
                let targs = TargetArgs { id: None, name: None, query: Some(query.clone()) };
                (resolve_chat(&conn, &targs, &format!("folder_id = {} AND deleted_at IS NULL", fid)), false)
            } else {
                (None, false)
            }
        },
        DeleteTarget::Archived { target } => (resolve_chat(&conn, target, "archived = 1 AND deleted_at IS NULL"), false),
        DeleteTarget::Deleted { target } => (resolve_chat(&conn, target, "deleted_at IS NOT NULL"), true),
    };

    if let Some(id) = chat_id {
        let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).unwrap_or_else(|_| "Unknown".to_string());
        
        if !yes {
            let msg = if is_perma { format!("Permanently delete chat '{}' (ID: {})?", title, id) } else { format!("Move chat '{}' (ID: {}) to trash?", title, id) };
            print!("{} (y/N): ", msg);
            stdout().flush().unwrap();
            let mut input = String::new();
            std::io::stdin().read_line(&mut input).unwrap();
            if input.trim().to_lowercase() != "y" {
                print_result("Cancelled.");
                return;
            }
        }

        if is_perma {
            conn.execute("DELETE FROM messages WHERE chat_id = ?1", [id]).unwrap();
            conn.execute("DELETE FROM chats WHERE id = ?1", [id]).unwrap();
            print_result(&format!("Permanently deleted chat: {} (ID: {})", title, id));
        } else {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
            conn.execute("UPDATE chats SET deleted_at = ?1 WHERE id = ?2", [now, id]).unwrap();
            conn.execute("UPDATE settings SET active_chat_id = NULL WHERE active_chat_id = ?1", [id]).unwrap();
            print_result(&format!("Moved to trash: {} (ID: {})", title, id));
        }
    } else {
        eprintln!("Chat not found.");
    }
}

fn handle_restore(target: &TargetArgs, yes: bool) {
    let conn = open_db().expect("Failed to open DB");
    if let Some(id) = resolve_chat(&conn, target, "deleted_at IS NOT NULL") {
        let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        if !yes {
            print!("Restore chat '{}' (ID: {}) from trash? (y/N): ", title, id);
            stdout().flush().unwrap();
            let mut input = String::new();
            std::io::stdin().read_line(&mut input).unwrap();
            if input.trim().to_lowercase() != "y" {
                print_result("Cancelled.");
                return;
            }
        }
        conn.execute("UPDATE chats SET deleted_at = NULL WHERE id = ?1", [id]).unwrap();
        print_result(&format!("Restored chat: {} (ID: {})", title, id));
    } else {
        eprintln!("Chat not found in trash.");
    }
}

fn handle_archive(target: &TargetArgs, yes: bool) {
    let conn = open_db().expect("Failed to open DB");
    if let Some(id) = resolve_chat(&conn, target, "archived = 0 AND deleted_at IS NULL") {
        let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        if !yes {
            print!("Archive chat '{}' (ID: {})? (y/N): ", title, id);
            stdout().flush().unwrap();
            let mut input = String::new();
            std::io::stdin().read_line(&mut input).unwrap();
            if input.trim().to_lowercase() != "y" {
                print_result("Cancelled.");
                return;
            }
        }
        conn.execute("UPDATE chats SET archived = 1 WHERE id = ?1", [id]).unwrap();
        print_result(&format!("Archived chat: {} (ID: {})", title, id));
    } else {
        eprintln!("Active chat not found.");
    }
}

fn handle_unarchive(target: &TargetArgs, yes: bool) {
    let conn = open_db().expect("Failed to open DB");
    if let Some(id) = resolve_chat(&conn, target, "archived = 1 AND deleted_at IS NULL") {
        let title: String = conn.query_row("SELECT title FROM chats WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        if !yes {
            print!("Unarchive chat '{}' (ID: {})? (y/N): ", title, id);
            stdout().flush().unwrap();
            let mut input = String::new();
            std::io::stdin().read_line(&mut input).unwrap();
            if input.trim().to_lowercase() != "y" {
                print_result("Cancelled.");
                return;
            }
        }
        conn.execute("UPDATE chats SET archived = 0 WHERE id = ?1", [id]).unwrap();
        print_result(&format!("Unarchived chat: {} (ID: {})", title, id));
    } else {
        eprintln!("Archived chat not found.");
    }
}

fn get_system_prompt(conn: &Connection, preset_arg: Option<&str>, settings: &Settings) -> String {
    let mut preset_id = settings.cli_preset_id.or(settings.selected_preset_id);
    
    if let Some(p) = preset_arg {
        if let Ok(id) = p.parse::<i64>() {
            let exists: bool = conn.query_row("SELECT 1 FROM presets WHERE id = ?1", [id], |_| Ok(true)).unwrap_or(false);
            if exists { preset_id = Some(id); }
        } else {
            let id: Option<i64> = conn.query_row("SELECT id FROM presets WHERE name = ?1 COLLATE NOCASE LIMIT 1", [p], |r| r.get(0)).ok();
            if let Some(id) = id { preset_id = Some(id); }
        }
    }
    
    if let Some(id) = preset_id {
        if let Ok(content) = conn.query_row("SELECT customization_prompt FROM presets WHERE id = ?1", [id], |r| r.get::<_, String>(0)) {
            return content;
        }
    }
    
    "You are Cubiq. Give the shortest correct answer possible. Skip greetings, preambles, filler, and explanations unless the user asks for them. Be direct and efficient.".to_string()
}

async fn handle_ask(prompt_opt: Option<&str>, once: bool, preset_opt: Option<&str>, do_stream: bool) {
    let conn = open_db().expect("Failed to open DB");
    
    let settings: Settings = conn.query_row(
        "SELECT app_theme, theme, accent_theme, api_key, model_url, model_name, selected_preset_id, trash_retention_days, active_chat_id, active_folder_id, last_chat_id, cli_preset_id FROM settings WHERE id = 1",
        (),
        |r| {
            Ok(Settings {
                app_theme: r.get(0)?,
                theme: r.get(1)?,
                accent_theme: r.get(2)?,
                api_key: r.get(3)?,
                model_url: r.get(4)?,
                model_name: r.get(5)?,
                selected_preset_id: r.get(6)?,
                trash_retention_days: r.get(7)?,
                active_chat_id: r.get(8)?,
                active_folder_id: r.get(9)?,
                last_chat_id: r.get(10)?,
                cli_preset_id: r.get(11)?,
                ..Default::default()
            })
        },
    ).unwrap();

    if settings.api_key.is_empty() {
        eprintln!("API key is missing. Please set it in the GUI Settings.");
        std::process::exit(1);
    }

    if once {
        if let Some(prompt) = prompt_opt {
            let sys_prompt = get_system_prompt(&conn, preset_opt, &settings);
            let messages = vec![
                ("system".to_string(), sys_prompt),
                ("user".to_string(), prompt.to_string()),
            ];
            if do_stream {
                stream_completion(&settings.api_key, &settings.model_url, &settings.model_name, messages).await;
            } else {
                match ai::chat_completion(&settings.api_key, &settings.model_url, &settings.model_name, messages).await {
                    Ok(content) => print_result(&content),
                    Err(e) => eprintln!("Error: {}", e),
                }
            }
        } else {
            eprintln!("Error: --once requires a prompt.");
            std::process::exit(1);
        }
        return;
    }

    // REPL mode
    let mut history_guard = EPHEMERAL_HISTORY.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap();
    // System prompt is rebuilt per request in send_ephemeral_message, not stored in history.

    if let Some(p) = prompt_opt {
        // Send first message
        send_ephemeral_message(&conn, &settings, &mut history_guard, p, preset_opt, do_stream).await;
    }

    loop {
        print!("> ");
        stdout().flush().unwrap();
        let mut input = String::new();
        if io::stdin().read_line(&mut input).is_err() {
            println!();
            break;
        }
        let input = input.trim();
        if input.is_empty() {
            continue;
        }
        if input == "--exit" {
            break;
        }
        if input == "--clear" {
            history_guard.clear();
            println!("Ephemeral history cleared.");
            continue;
        }
        send_ephemeral_message(&conn, &settings, &mut history_guard, input, preset_opt, do_stream).await;
    }
}

async fn send_ephemeral_message(conn: &Connection, settings: &Settings, history: &mut Vec<(String, String)>, prompt: &str, preset_opt: Option<&str>, do_stream: bool) {
    history.push(("user".to_string(), prompt.to_string()));
    
    // Enforce 40 message cap (rolling buffer: 20 turns)
    // Try to remove in pairs (user + assistant) to keep context coherent
    while history.len() > 40 {
        if history.len() >= 2 && history[0].0 == "user" && history[1].0 == "assistant" {
            history.remove(0);
            history.remove(0);
        } else {
            history.remove(0);
        }
    }

    let sys_prompt = get_system_prompt(conn, preset_opt, settings);
    let mut messages = vec![("system".to_string(), sys_prompt)];
    messages.extend(history.iter().cloned());

    let final_content = if do_stream {
        stream_completion(&settings.api_key, &settings.model_url, &settings.model_name, messages).await
    } else {
        match ai::chat_completion(&settings.api_key, &settings.model_url, &settings.model_name, messages).await {
            Ok(content) => {
                print_result(&content);
                Some(content)
            },
            Err(e) => {
                eprintln!("Error: {}", e);
                None
            }
        }
    };

    if let Some(content) = final_content {
        history.push(("assistant".to_string(), content));
        // Enforce 40 message cap again after assistant response
        while history.len() > 40 {
            if history.len() >= 2 && history[0].0 == "user" && history[1].0 == "assistant" {
                history.remove(0);
                history.remove(0);
            } else {
                history.remove(0);
            }
        }
    }
}

async fn handle_send(message: &str, do_stream: bool) {
    let conn = open_db().expect("Failed to open DB");
    
    let settings: Settings = conn.query_row(
        "SELECT app_theme, theme, accent_theme, api_key, model_url, model_name, selected_preset_id, trash_retention_days, active_chat_id, active_folder_id, last_chat_id, cli_preset_id FROM settings WHERE id = 1",
        (),
        |r| {
            Ok(Settings {
                app_theme: r.get(0)?,
                theme: r.get(1)?,
                accent_theme: r.get(2)?,
                api_key: r.get(3)?,
                model_url: r.get(4)?,
                model_name: r.get(5)?,
                selected_preset_id: r.get(6)?,
                trash_retention_days: r.get(7)?,
                active_chat_id: r.get(8)?,
                active_folder_id: r.get(9)?,
                last_chat_id: r.get(10)?,
                cli_preset_id: r.get(11)?,
                ..Default::default()
            })
        },
    ).unwrap();

    if settings.api_key.is_empty() {
        eprintln!("API key is missing. Please set it in the GUI Settings.");
        std::process::exit(1);
    }

    let target_chat_id = settings.active_chat_id;
    if target_chat_id.is_none() {
        eprintln!("No active chat. Use `cubiq new` to create one or `cubiq open` to select one.");
        std::process::exit(2);
    }
    
    let chat_id = target_chat_id.unwrap();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
    
    conn.execute(
        "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?1, 'user', ?2, ?3)",
        (chat_id, message, now),
    ).unwrap();
    conn.execute("UPDATE chats SET updated_at = ?1 WHERE id = ?2", (now, chat_id)).unwrap();

    let mut stmt = conn.prepare("SELECT role, content FROM messages WHERE chat_id = ?1 ORDER BY created_at ASC").unwrap();
    let mut messages: Vec<(String, String)> = Vec::new();
    let rows = stmt.query_map([chat_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap();
    for row in rows {
        if let Ok((role, content)) = row {
            messages.push((role, content));
        }
    }

    let final_content = if do_stream {
        stream_completion(&settings.api_key, &settings.model_url, &settings.model_name, messages).await
    } else {
        match ai::chat_completion(&settings.api_key, &settings.model_url, &settings.model_name, messages).await {
            Ok(content) => {
                print_result(&content);
                Some(content)
            },
            Err(e) => {
                eprintln!("Error: {}", e);
                None
            }
        }
    };

    if let Some(content) = final_content {
        let now_end = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
        conn.execute(
            "INSERT INTO messages (chat_id, role, content, created_at) VALUES (?1, 'assistant', ?2, ?3)",
            (chat_id, content, now_end),
        ).unwrap();
        conn.execute("UPDATE chats SET updated_at = ?1 WHERE id = ?2", (now_end, chat_id)).unwrap();
    }
}

fn handle_close() {
    let conn = open_db().expect("Failed to open DB");
    let active_chat_id: Option<i64> = conn.query_row("SELECT active_chat_id FROM settings WHERE id = 1", (), |r| r.get(0)).unwrap_or(None);
    if active_chat_id.is_some() {
        conn.execute("UPDATE settings SET active_chat_id = NULL WHERE id = 1", []).unwrap();
        print_result("Closed active chat.");
    } else {
        print_result("No active chat.");
    }
}

fn handle_new(title_opt: Option<&str>, workspace_opt: Option<&str>, preset_opt: Option<&str>) {
    let conn = open_db().expect("Failed to open DB");
    
    let folder_id: Option<i64> = if let Some(ws) = workspace_opt {
        let fid: Option<i64> = if ws.chars().all(|c| c.is_ascii_digit()) {
            let id = ws.parse::<i64>().unwrap();
            if conn.query_row("SELECT 1 FROM folders WHERE id = ?1", [id], |_| Ok(true)).unwrap_or(false) {
                Some(id)
            } else { None }
        } else {
            let exact: Option<i64> = conn.query_row("SELECT id FROM folders WHERE name = ?1 COLLATE NOCASE LIMIT 1", [ws], |r| r.get(0)).ok();
            if exact.is_some() {
                exact
            } else {
                let mut stmt = conn.prepare("SELECT id FROM folders WHERE name LIKE ?1").unwrap();
                let mut rows = stmt.query_map([format!("%{}%", ws)], |r| r.get::<_, i64>(0)).unwrap();
                if let Some(Ok(id)) = rows.next() {
                    Some(id)
                } else {
                    None
                }
            }
        };
        
        if fid.is_none() {
            eprintln!("Error: Workspace '{}' not found.", ws);
            std::process::exit(2);
        }
        fid
    } else {
        conn.query_row("SELECT active_folder_id FROM settings WHERE id = 1", (), |r| r.get(0)).unwrap_or(None)
    };
    
    let mut preset_locked = 0;
    let mut chat_preset_id: Option<i64> = None;
    if let Some(p) = preset_opt {
        let pid: Option<i64> = if p.chars().all(|c| c.is_ascii_digit()) {
            let id = p.parse::<i64>().unwrap();
            if conn.query_row("SELECT 1 FROM presets WHERE id = ?1", [id], |_| Ok(true)).unwrap_or(false) {
                Some(id)
            } else { None }
        } else {
            conn.query_row("SELECT id FROM presets WHERE name = ?1 COLLATE NOCASE LIMIT 1", [p], |r| r.get(0)).ok()
        };
        if let Some(id) = pid {
            chat_preset_id = Some(id);
            preset_locked = 1;
        }
    }
    
    let title = title_opt.unwrap_or("New Chat").to_string();
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
    
    let user_edited = if title_opt.is_some() { 1 } else { 0 };
    
    conn.execute(
        "INSERT INTO chats (title, created_at, updated_at, archived, preset_locked, user_edited_title, folder_id, preset_id) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)",
        params![title, now, now, preset_locked, user_edited, folder_id, chat_preset_id],
    ).unwrap();
    let new_id = conn.last_insert_rowid();
    
    conn.execute("UPDATE settings SET active_chat_id = ?1, last_chat_id = ?1 WHERE id = 1", [new_id]).unwrap();
    
    print_result(&format!("Created chat: {} (ID: {})", title, new_id));
}

async fn stream_completion(api_key: &str, base_url: &str, model: &str, messages: Vec<(String, String)>) -> Option<String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    
    let api_messages: Vec<serde_json::Value> = messages
        .into_iter()
        .map(|(role, content)| {
            serde_json::json!({ "role": role, "content": content })
        })
        .collect();

    let body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "temperature": 0.7,
        "max_tokens": 4096,
        "stream": true,
    });

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .unwrap();

    let response = match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Network error: {}", e);
            return None;
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        eprintln!("API error: HTTP {} - {}", status.as_u16(), body_text);
        return None;
    }

    let mut byte_stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut accumulated = String::new();

    while let Some(chunk) = byte_stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                buffer.push_str(&text);

                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].trim().to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if line.is_empty() || line.starts_with(':') {
                        continue;
                    }

                    if line == "data: [DONE]" {
                        println!();
                        stdout().flush().unwrap();
                        return Some(accumulated);
                    }

                    if let Some(json_str) = line.strip_prefix("data: ") {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                            if let Some(err) = parsed.get("error") {
                                let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown streaming error");
                                eprintln!("Error in stream: {}", msg);
                                return None;
                            }

                            if let Some(delta) = parsed
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("delta"))
                                .and_then(|d| d.get("content"))
                                .and_then(|c| c.as_str())
                            {
                                if !delta.is_empty() {
                                    accumulated.push_str(delta);
                                    // Use raw bytes to avoid encoding issues in some shells
                                    stdout().write_all(delta.as_bytes()).unwrap();
                                    stdout().flush().unwrap();
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("\nStream read error: {}", e);
                return Some(accumulated);
            }
        }
    }
    
    println!();
    stdout().flush().unwrap();
    Some(accumulated)
}
