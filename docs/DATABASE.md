# Database Architecture

Cubiq uses a single, canonical SQLite database to store all settings, chats, and messages. This ensures that the GUI, QuickAsk, and CLI always have a consistent view of the data.

## Canonical Location

The database is located at:
`%APPDATA%\com.cubiq.desktop\cubiq.db`

(Usually `C:\Users\<User>\AppData\Roaming\com.cubiq.desktop\cubiq.db`)

## Path Resolution

Both the GUI and CLI use a unified resolution logic (defined in `cubiq_lib::db::resolve_db_path`):

1. **Explicit Override**: Provided via the `--db` CLI flag.
2. **Environment Variable**: Provided via `CUBIQ_DB_PATH`.
3. **Default**: The path in the Tauri app data directory for `com.cubiq.desktop`.

### Migration Logic

On startup, if the database is missing from the canonical location, the app automatically checks for legacy databases from older versions (e.g., `com.cubiq.app`, `cubiq`) and migrates the data forward, creating a `.bak` file for safety.

## Configuration Storage

The `settings` table (where `id = 1`) contains global configuration:

- **API Keys**: Stored in the `api_key` column.
- **Model Config**: `model_url` and `model_name`.
- **UI State**: `app_theme`, `accent_theme`, and the `active_chat_id`.
- **CLI State**: `cli_preset_id` and `active_folder_id`.

The CLI reads these values directly to authenticate with AI providers and determine which chat is "active" when you run `cubiq send`.

## Concurrency and Safety

- **WAL Mode**: The database uses **Write-Ahead Logging (WAL)** to allow the GUI and CLI to read and write simultaneously without locking each other out.
- **Busy Timeout**: A 5-second busy timeout is configured to handle transient locks.
- **Backups**: During migrations, the app creates `.db.bak` copies. It is recommended that users manually back up the `cubiq.db` file before major system changes.

## Schema Versioning

The database uses `PRAGMA user_version` to track migrations. Migrations are applied automatically by the Rust backend on startup.

- **v1**: Added Presets and Accent Themes.
- **v3**: Added Workspaces (folders).
- **v4**: Added Soft-delete (trash) and Retention settings.
- **v5**: Added CLI-related settings fields (active chat/folder tracking + CLI preset id).
