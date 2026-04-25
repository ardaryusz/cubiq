# Installer Architecture

Cubiq uses a customized NSIS (Nullsoft Scriptable Install System) workflow to handle per-machine installation and CLI integration.

## NSIS Hooks (`hooks.nsh`)

The core of our custom installation logic lives in `src-tauri/nsis/hooks.nsh`. These hooks are triggered by Tauri's standard installer at specific lifecycle events.

### Post-Install Workflow

1. **CLI Location**: The installer creates a `cli` directory inside the installation folder (e.g., `C:\Program Files\cubiq\cli`).
2. **Binary Renaming**: It finds the bundled sidecar binary (e.g., `cubiq-cli-x86_64-pc-windows-msvc.exe`) and moves/renames it to `cubiq.exe` inside the `cli` folder.
3. **PATH Update**: It calls the `AddToPath` function to add the `cli` folder to the system `PATH`.

### Safe PATH Management

The `AddToPath` and `RemoveFromPath` functions in `hooks.nsh` are designed to be safe and idempotent:

- **Idempotency**: It checks if the path already exists before adding it, preventing duplicates.
- **Boundaries**: It uses semicolon separators correctly to avoid merging paths.
- **Safety**: During uninstallation, it performs validation (length checks, existence of `System32`) to ensure it never accidentally clobbers the system `PATH`.
- **Broadcast**: It sends a `WM_SETTINGCHANGE` message so that many applications (like File Explorer) recognize the change immediately without a reboot.

## Installation Mode: `perMachine`

Cubiq is configured to install for all users on the system.

- **Registry**: Keys are stored in `HKLM` (HKEY_LOCAL_MACHINE).
- **Files**: Installed to `%ProgramFiles%\cubiq`.
- **Permissions**: Requires UAC elevation to install and uninstall.

## Install from PowerShell (one command)

Cubiq installs **per-machine** (requires UAC/Admin) and adds the CLI to system PATH.

### Interactive install (prompts, recommended)

This downloads the latest installer from GitHub Releases and runs it (UAC prompt will appear):

```powershell
$repo="ardaryusz/cubiq"; $rel=irm "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent"="cubiq-installer" }; $asset=$rel.assets | ? { $_.name -match 'x64-setup\.exe$' } | select -First 1; if(-not $asset){ throw "No x64-setup.exe asset found in latest release." }; $tmp=Join-Path $env:TEMP $asset.name; iwr $asset.browser_download_url -OutFile $tmp; Start-Process $tmp -Verb RunAs -Wait
```

### Non-interactive install (quiet)

This downloads the latest installer and runs it silently. It will still trigger a UAC prompt (you must allow it), but the installer UI will not show:

```powershell
$repo="ardaryusz/cubiq"; $rel=irm "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent"="cubiq-installer" }; $asset=$rel.assets | ? { $_.name -match 'x64-setup\.exe$' } | select -First 1; if(-not $asset){ throw "No x64-setup.exe asset found in latest release." }; $tmp=Join-Path $env:TEMP $asset.name; iwr $asset.browser_download_url -OutFile $tmp; Start-Process $tmp -Verb RunAs -Wait -ArgumentList "/S"
```

## Reproducing a Release Build

To produce a production-ready installer:

1. **Clean**: Ensure `src-tauri/target` and `dist` are clean.
2. **Sidecar**: Run `.\scripts\build-cli-sidecar.ps1`.
3. **Frontend**: Run `pnpm build`.
4. **Bundle**: Run `pnpm tauri build`.

## Testing Installer Correctness

Before shipping a release, verify:

1. **Clean Install**: Does it prompt for UAC? Is `cubiq` available in a new terminal?
2. **Reinstall**: Run the installer again. Does it avoid adding duplicate `PATH` entries?
3. **Uninstall**: Remove Cubiq. Is the `cli` folder gone? Is the `PATH` entry removed? Are other system paths preserved?
4. **App Launch**: Does the GUI launch? Does the CLI connect to the same DB?

## Bumping Version

Update the version in:

1. `package.json`
2. `src-tauri/tauri.conf.json`
3. `src-tauri/Cargo.toml`
4. `src-tauri/src/bin/cubiq.rs` (if hardcoded in `clap` attributes)
