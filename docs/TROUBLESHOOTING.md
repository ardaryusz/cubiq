# Troubleshooting

Common issues and their solutions for Cubiq.

## Installer Issues

### `makensis` command not found

Building the installer requires NSIS.

- **Fix**: Download and install [NSIS](https://nsis.sourceforge.io/Download) and add its folder (e.g., `C:\Program Files (x86)\NSIS`) to your system `PATH`.

### PATH entry not working

If `cubiq` is not recognized after installation.

- **Fix**: Open a **new** terminal window. If that fails, check the system environment variables manually to ensure `C:\Program Files\cubiq\cli` is present.

### Installer fails to overwrite

If the app is running during installation/uninstallation, files may be locked.

- **Fix**: Ensure Cubiq and all terminal windows using the CLI are closed before running the installer or uninstaller.

---

## CLI Issues

### "API key missing"

The CLI cannot communicate with AI models without a key.

- **Fix**: Open the Cubiq GUI, go to **Settings**, and enter your API key. Alternatively, check if the CLI is looking at the correct database with `cubiq debug db`.

### Piped output looks weird (encoding)

If you see characters like `ÔÇÖ` in your redirected files or PowerShell pipes.

- **Fix**: Cubiq handles this automatically; if your environment is cursed anyway, try to ensure your PowerShell `$OutputEncoding` is set to UTF8 or use the `--once` flag which is optimized for piping.

### CLI sees wrong database

If your CLI chats don't match your GUI chats.

- **Fix**: Run `cubiq debug db`. It will show the resolved path and any candidate databases found. Ensure it points to `%APPDATA%\com.cubiq.desktop\cubiq.db`.

---

## App Issues

### QuickAsk stuck "thinking"

If the QuickAsk window is open but not responding.

- **Fix**: This can happen if the backend event loop is blocked or the API key is invalid. Check the app logs at `%APPDATA%\com.cubiq.desktop\logs\app.log`.

### App opens then closes

If the GUI fails to launch.

- **Fix**: This is often due to a corrupt configuration or database. Try renaming your `cubiq.db` file to `cubiq.db.old` and restarting the app. If it launches, the issue was in the DB state.

### DevTools not opening

- **Fix**: DevTools are only enabled in `dev` builds. In production builds, they are disabled for security and performance.
