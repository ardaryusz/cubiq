use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_positioner::{WindowExt, Position};

/// True once the first tray icon event fires → tray geometry known.
static TRAY_INITIALIZED: AtomicBool = AtomicBool::new(false);

/// Mirror of the frontend "pinned" toggle.  Set via `set_quickask_pinned` command.
pub static QUICKASK_PINNED: AtomicBool = AtomicBool::new(false);

/// Guards against spawning multiple watcher threads simultaneously.
static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

// ── Tray creation ─────────────────────────────────────────────────────────────

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};

    let center_i = MenuItem::with_id(app, "center", "Center QuickAsk", true, None::<&str>)?;
    let quit_i   = MenuItem::with_id(app, "quit",   "Quit",            true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&center_i, &quit_i])?;

    // Use the default app icon now; the correct themed logo is set
    // moments later when the webview calls set_tray_icon_mode via matchMedia.
    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "center" => center_quickask(app),
            "quit"   => app.exit(0),
            _        => {}
        })
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            TRAY_INITIALIZED.store(true, Ordering::SeqCst);

            if let TrayIconEvent::Click { button, button_state, .. } = event {
                match (button, button_state) {
                    (MouseButton::Left, MouseButtonState::Up) => {
                        toggle_quickask(tray.app_handle());
                    }
                    _ => {}
                }
            }
        })
        .build(app)?;

    Ok(())
}

// ── Tray icon theming (called ONCE from JS after webview loads) ───────────────
//
// mode = "dark"  means OS theme is Dark  → use lightLogo.png (light on dark bg)
// mode = "light" means OS theme is Light → use darkLogo.png  (dark on light bg)

pub fn set_tray_icon_from_mode(app: &AppHandle, mode: &str) -> tauri::Result<()> {
    let icon_name = if mode == "dark" { "lightLogo.png" } else { "darkLogo.png" };
    let icon_path = app.path().resource_dir()?.join(icon_name);

    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Ok(icon) = tauri::image::Image::from_path(icon_path) {
            let _ = tray.set_icon(Some(icon));
        }
    }
    Ok(())
}


// ── Window show / hide / toggle ───────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
struct ThemePayload {
    app_theme: String,
}

fn emit_theme_sync(app: &AppHandle, window: &tauri::WebviewWindow<tauri::Wry>) {
    let app_theme = {
        let state = app.state::<crate::commands::AppState>();
        let db = state.db.lock().unwrap();
        let mut stmt = db.prepare("SELECT app_theme FROM settings WHERE id = 1").unwrap();
        stmt.query_row((), |row| row.get::<_, String>(0)).unwrap_or_else(|_| "cubiq-dark".to_string())
    };
    let _ = window.emit("cubiq:theme_changed", ThemePayload { app_theme });
}

pub fn show_quickask(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quickask") {
        emit_theme_sync(app, &window);
        
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 420.0,
            height: 550.0,
        }));
        let _ = window.show();
        let _ = window.set_focus();

        position_quickask(&window);

        // Notify frontend to re-sync theme on every open
        let _ = window.emit("quickask-shown", ());

        // Start the background focus watcher (no-op if already running)
        start_focus_watcher(app.clone());
    }
}

pub fn hide_quickask(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quickask") {
        let _ = window.hide();
        // Watcher will detect is_visible==false and stop itself next tick
    }
}

pub fn toggle_quickask(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quickask") {
        if window.is_visible().unwrap_or(false) {
            hide_quickask(app);
        } else {
            show_quickask(app);
        }
    }
}

pub fn center_quickask(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quickask") {
        emit_theme_sync(app, &window);
        let _ = window.move_window(Position::Center);
        let _ = window.show();
        let _ = window.set_focus();
        start_focus_watcher(app.clone());
    }
}

// ── Background focus watcher ──────────────────────────────────────────────────

fn start_focus_watcher(app: AppHandle) {
    if WATCHER_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));

        loop {
            std::thread::sleep(std::time::Duration::from_millis(70));

            let window = match app.get_webview_window("quickask") {
                Some(w) => w,
                None => break,
            };

            if !window.is_visible().unwrap_or(false) {
                break;
            }

            let is_focused = window.is_focused().unwrap_or(true);
            let is_pinned  = QUICKASK_PINNED.load(Ordering::SeqCst);

            if !is_focused && !is_pinned {
                let _ = window.emit("quickask:clear", ());
                std::thread::sleep(std::time::Duration::from_millis(20));
                let _ = window.hide();
                break;
            }
        }

        WATCHER_ACTIVE.store(false, Ordering::SeqCst);
    });
}

// ── Internal positioning helpers ──────────────────────────────────────────────

fn position_quickask(window: &tauri::WebviewWindow<tauri::Wry>) {
    if TRAY_INITIALIZED.load(Ordering::SeqCst) {
        #[cfg(target_os = "macos")]
        let pos = Position::TrayTopRight;
        #[cfg(not(target_os = "macos"))]
        let pos = Position::TrayBottomRight;

        let _ = window.move_window(pos);
        clamp_to_monitor(window);
    } else {
        fallback_bottom_right(window);
    }
}

fn clamp_to_monitor(window: &tauri::WebviewWindow<tauri::Wry>) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let m_pos  = monitor.position();
        let m_size = monitor.size();
        let win_pos  = window.outer_position().unwrap_or(tauri::PhysicalPosition { x: 0, y: 0 });
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize { width: 0, height: 0 });

        let mut x = win_pos.x;
        let mut y = win_pos.y;
        let right_limit  = m_pos.x + m_size.width  as i32 - win_size.width  as i32;
        let bottom_limit = m_pos.y + m_size.height as i32 - win_size.height as i32;

        if x < m_pos.x     { x = m_pos.x; }
        if x > right_limit  { x = right_limit; }
        if y < m_pos.y     { y = m_pos.y; }
        if y > bottom_limit { y = bottom_limit; }

        let _ = window.set_position(tauri::PhysicalPosition { x, y });
    }
}

fn fallback_bottom_right(window: &tauri::WebviewWindow<tauri::Wry>) {
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let m_pos    = monitor.position();
        let m_size   = monitor.size();
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize { width: 420, height: 550 });

        const MARGIN: i32 = 12;
        let x = m_pos.x + m_size.width  as i32 - win_size.width  as i32 - MARGIN;
        let y = m_pos.y + m_size.height as i32 - win_size.height as i32 - MARGIN;
        let _ = window.set_position(tauri::PhysicalPosition { x, y });
    }
}
