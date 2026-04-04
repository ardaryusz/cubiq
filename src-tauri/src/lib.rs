pub mod db;
pub mod models;
pub mod commands;
pub mod ai;

use commands::AppState;
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

      let app_dir = app.path().app_data_dir().expect("Failed to get app_data_dir");
      let db = db::init_db(app_dir).expect("Failed to initialize database");
      app.manage(AppState {
          db: std::sync::Mutex::new(db),
      });

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
        commands::test_connection
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
