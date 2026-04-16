use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

pub fn setup_hotkeys(app: &AppHandle) -> tauri::Result<()> {
    let ctrl_shift_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let ctrl_shift_c = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyC);
    
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if shortcut == &ctrl_shift_space {
                        crate::tray::toggle_quickask(app);
                    } else if shortcut == &ctrl_shift_c {
                        crate::tray::center_quickask(app);
                    }
                }
            })
            .with_shortcut(ctrl_shift_space).unwrap()
            .with_shortcut(ctrl_shift_c).unwrap()
            .build()
    )?;
    Ok(())
}
