use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

pub fn setup_hotkeys(app: &AppHandle) -> tauri::Result<()> {
    // Only ONE global shortcut — Ctrl+Alt+Space — toggles the Cubiquick popup.
    // All other shortcuts (P/D/C in quickask, N in main) are window-scoped DOM listeners.
    let ctrl_alt_space = Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT),
        Code::Space,
    );

    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if shortcut == &ctrl_alt_space {
                        // If Cubiquick is pinned, the hotkey must not hide it.
                        // Only toggle when unpinned; when pinned just focus the existing window.
                        let pinned = crate::tray::QUICKASK_PINNED
                            .load(std::sync::atomic::Ordering::SeqCst);
                        if pinned {
                            log::info!("[hotkey] Ctrl+Alt+Space suppressed — Cubiquick is pinned");
                            // Bring it to focus in case it got buried, but do NOT hide it.
                            if let Some(win) = app.get_webview_window("quickask") {
                                let _ = win.set_focus();
                            }
                        } else {
                            log::info!("[hotkey] Ctrl+Alt+Space → toggle_quickask");
                            crate::tray::toggle_quickask(app);
                        }
                    }
                }
            })
            .with_shortcut(ctrl_alt_space)
            .unwrap()
            .build(),
    )?;

    Ok(())
}
