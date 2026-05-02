# Changelog

All notable changes to Cubiq will be documented in this file.

This project loosely follows [Semantic Versioning](https://semver.org/).

---

## [1.0.1] - 2026-05-02

### Fixed

- Changed GUI startup behavior so Cubiq no longer reopens the previously active chat on launch.
- The main app now starts on the new chat / empty composer screen by default.
- Changed CLI active-chat behavior so it no longer stores long-lived active chat state in the shared database.
- Replaced persisted CLI active chat state with an ephemeral CLI session file:
  - `%LOCALAPPDATA%\Cubiq\cli-session.json`
- `cubiq close` now clears the CLI session context.
- `cubiq status` now shows `Active Chat: None` after the CLI session context is cleared.
- Removed the previous 1-hour timeout approach for CLI active chat clearing.

### Changed

- CLI `new` and `open` now update the temporary CLI session file so that later `send` commands know which chat to use.
- GUI and CLI persistent data remain shared through the canonical SQLite database.
- Active UI/session state is now separated from persistent chat data. Finally, the app stopped waking up inside yesterday’s conversation like it owed it money.

### Internal

- Removed unused `last_cli_active_at` / `last_gui_active_at` session timestamp fields.
- Reverted the temporary migration that added those timestamp fields.
- Cleaned up related Rust and TypeScript settings models.

---

## [1.0.0] - 2026-05-02

### Added

- Initial public Windows release.
- Tauri desktop app with main GUI chat interface.
- Cubiq QuickAsk window for fast ephemeral prompting.
- Persistent local SQLite database for chats, messages, settings, presets, and workspaces.
- CLI executable installed as `cubiq`.
- CLI ephemeral REPL via `cubiq ask`.
- CLI persistent chat workflow:
  - `cubiq new`
  - `cubiq send`
  - `cubiq open`
  - `cubiq close`
  - `cubiq list`
  - `cubiq delete`
  - `cubiq restore`
  - `cubiq archive`
  - `cubiq unarchive`
  - `cubiq status`
  - `cubiq where`
- Canonical shared database path:
  - `%APPDATA%\com.cubiq.desktop\cubiq.db`
- Automatic legacy database migration into the canonical database path.
- NSIS Windows installer.
- Per-machine installation to Program Files.
- CLI sidecar installation to:
  - `C:\Program Files\cubiq\cli\cubiq.exe`
- Safe installer PATH handling for adding/removing Cubiq CLI from system PATH.
- Documentation set:
  - README
  - Installation guide
  - CLI guide
  - Development guide
  - Installer guide
  - Database guide
  - Troubleshooting guide
  - Contributing guide
  - Security guide

### Notes

- This release established the baseline installer, CLI, GUI, database, and documentation workflow.
