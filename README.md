# Cubiq

Cubiq is a modern, high-performance desktop AI assistant for Windows, featuring a powerful GUI, a lightweight ephemeral QuickAsk interface, and a robust CLI for power users.

## Features

- **Main GUI**: A full-featured chat interface for managing persistent conversations and workspaces.
- **QuickAsk**: A global, always-on-top ephemeral popup for quick questions (`Ctrl+Alt+Space`).
- **Unified CLI**: A powerful command-line interface that shares state with the desktop app.
- **Workspaces**: Organize your chats into folders.
- **Presets**: Custom system prompts and model configurations (Research, Programming, etc.).
- **Privacy First**: Local SQLite database and secure API key management.
- **Soft Delete**: Integrated trash system with auto-purge.

## Quickstart

### Installation (Windows)

1. Download the latest `cubiq_0.1.0_x64-setup.exe` installer.
2. Run the installer (requires UAC for per-machine installation).
3. Cubiq will be installed to `C:\Program Files\cubiq`.
4. The CLI will be automatically added to your system `PATH`.
5. Open a new terminal and type `cubiq status` to verify.

### First Run

1. Launch Cubiq from the Start Menu.
2. Go to **Settings** and enter your API Key (e.g., Groq, OpenAI).
3. You're ready to chat!

## CLI Examples

The CLI provides two modes: **Ephemeral (REPL)** and **Persistent**.

### Ephemeral REPL

Ask quick questions without cluttering your database history.

```powershell
# Start an interactive session with 40-message memory
cubiq ask

# Ask a single question and exit
cubiq ask "How do I list files in PowerShell?" --once

# Use a specific preset for the session
cubiq ask --preset "Programming"
```

### Persistent Commands

Interact with your main app's chats and workspaces.

```powershell

# Create a new chat in a workspace
cubiq new --title "Project Brainstorm" --workspace "Ideas"

# Send a message to the currently active chat
cubiq send "What are the next steps?"

# List all workspaces
cubiq list workspaces

# Open a specific chat to make it active
cubiq open chats "Project Brainstorm"
```

## Documentation

Comprehensive documentation is available in the `docs/` folder:

- [Changelog](CHANGELOG.md)
- [Installation Guide](docs/INSTALLATION.md)
- [CLI Reference](docs/CLI.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Installer Details](docs/INSTALLER.md)
- [Database Architecture](docs/DATABASE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing](docs/CONTRIBUTING.md)
- [Security](docs/SECURITY.md)

## Screenshots

Coming soon...

## License

TBD
