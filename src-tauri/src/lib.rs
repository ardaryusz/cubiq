pub mod db;
pub mod models;
pub mod commands;
pub mod ai;
pub mod tray;
pub mod hotkey;
pub mod streaming;

use commands::AppState;
use streaming::StreamRegistry;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let (db_path, _) = db::resolve_db_path(None);
      let db = db::init_db(db_path).expect("Failed to initialize database");
      app.manage(AppState {
          db: std::sync::Mutex::new(db),
      });

      // Shared stream cancellation registry
      app.manage(StreamRegistry::new());

      app.handle().plugin(tauri_plugin_positioner::init())?;
      crate::tray::create_tray(app.handle())?;
      crate::hotkey::setup_hotkeys(app.handle())?;

      Ok(())
    })
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
        commands::get_settings,
        commands::update_settings,
        commands::get_presets,
        commands::create_preset,
        commands::update_preset,
        commands::delete_preset,
        commands::duplicate_preset,
        commands::export_presets,
        commands::export_presets_to_file,
        commands::import_presets,
        commands::update_chat_preset,
        commands::lock_chat_preset,
        commands::get_chats,
        commands::create_chat,
        commands::rename_chat,
        commands::archive_chat,
        commands::delete_chat,
        commands::get_messages,
        commands::add_message,
        commands::send_chat_message,
        commands::test_connection,
        // Phase A: Folders
        commands::get_folders,
        commands::get_folder_chat_previews,
        commands::create_folder,
        commands::rename_folder,
        commands::delete_folder,
        commands::get_folder_chat_count,
        commands::move_folder,
        commands::move_chat_to_folder,
        // Phase A: Empty chat guard
        commands::find_empty_chat,
        // Phase A: Bulk actions
        commands::bulk_archive_chats,
        commands::bulk_delete_chats,
        commands::bulk_move_chats,
        // Phase B: Trash
        commands::get_deleted_chats,
        commands::restore_chats,
        commands::delete_chats_permanently,
        commands::purge_expired_deleted_chats,
        commands::send_ephemeral_message,
        commands::open_main_window,
        commands::sync_quickask_theme,
        commands::set_tray_icon_mode,
        commands::set_quickask_pinned,
        commands::quit_app,
        // Streaming
        commands::start_ephemeral_stream,
        commands::start_chat_stream,
        commands::finalize_chat_stream,
        commands::cancel_stream,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
