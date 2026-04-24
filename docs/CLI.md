# CLI Reference

The Cubiq CLI (`cubiq`) is a powerful tool that allows you to interact with the Cubiq engine directly from your terminal. It shares the same database and configuration as the desktop app.

## Command Modes

The CLI operates in two primary modes:

### 1. Ephemeral Mode (`cubiq ask`)
Used for quick, throwaway questions. It does not persist messages to the database.

- **Interactive REPL**: Run `cubiq ask` without arguments to start a session. It maintains a rolling memory of the last **40 messages** (20 conversation turns).
- **Single-Shot**: Use `cubiq ask "your question" --once` for a stateless request.
- **Special Commands**:
  - `--exit`: Exit the REPL.
  - `--clear`: Clear the ephemeral memory in the current session.

### 2. Persistent Mode
Commands that interact with your workspaces, chats, and settings.

- `cubiq send "message"`: Sends a message to the currently active persistent chat.
- `cubiq new`: Creates a new persistent chat.
- `cubiq open`: Switches the active chat or workspace.

---

## Command Grammar

### Global Options
- `-y`, `--yes`: Skip confirmation prompts (e.g., when deleting).
- `--db <FILE>`: Override the database path for the current command.

### Subcommands

#### `status`
Show current status (active workspace, chat, preset, model).
```powershell
cubiq status
```

#### `where`
Print the "path" to the active location (e.g., `workspaces/Projects/Brainstorm`).
```powershell
cubiq where
```

#### `ask`
Ask a question in ephemeral mode.
- `prompt`: Optional first prompt.
- `--once`: Single-shot stateless request.
- `--preset <NAME>`: Override the system prompt/preset.
- `--no-stream`: Disable response streaming.

#### `send`
Send a message to the active persistent chat.
- `message`: The text to send.

#### `new`
Create a new persistent chat.
- `--title <TEXT>`: Optional explicit title.
- `--workspace <NAME/ID>`: Workspace to create the chat in.
- `--preset <NAME/ID>`: Preset to associate with the chat.

#### `open`
Navigate to a chat or workspace.
- `open chats <QUERY>`: Open a chat by ID or Name.
- `open workspaces <NAME> [<QUERY>]`: Open a workspace and optionally a chat within it.
- `open ..`: Go back to the last active chat.

#### `list`
List resources.
- `list chats`: Active chats.
- `list workspaces`: All workspaces.
- `list archived`: Archived chats.
- `list deleted`: Chats in the trash.

#### `delete`
Delete resources.
- `delete chats <QUERY>`: Move a chat to trash.
- `delete deleted <QUERY>`: Permanently delete a chat from trash.

#### `archive` / `unarchive` / `restore`
- `archive <QUERY>`: Archive a chat.
- `unarchive <QUERY>`: Move chat back to active.
- `restore <QUERY>`: Restore a chat from trash.

---

## Target Disambiguation
When a command accepts a `<QUERY>` (like `open` or `delete`), the following rules apply:
1. **Digits-only**: Interpreted as a **Chat ID** first. If no ID matches, it searches by name.
2. **String**: Searches for an **Exact Match** (case-insensitive) on the title.
3. **Partial Match**: If no exact match is found, it searches for chats containing the string.
4. **Ambiguity**: If multiple chats match, the CLI will list them and ask for a specific ID.

---

## Streaming and Piping

### Streaming Behavior
- **TTY (Interactive)**: Streaming is enabled by default.
- **Piped (Scripts)**: Streaming is disabled by default to ensure clean output. Use `--stream` to force it.

### PowerShell Piped Output
On Windows PowerShell, `cubiq` automatically handles encoding (UTF-16LE with BOM) when detected that output is being piped, preventing character corruption (e.g., "ÔÇÖ" instead of "'").

```powershell
# This works correctly even with special characters
cubiq ask "What is an apostrophe?" --once | Out-File result.txt
```

---

## Troubleshooting

### "API key missing"
The CLI reads the API key from the database. Launch the GUI and set your API key in **Settings** first.

### Wrong DB Path
If the CLI isn't seeing your GUI chats, use `cubiq debug db` to verify it's looking at the same file as the app: `%APPDATA%\com.cubiq.desktop\cubiq.db`.
