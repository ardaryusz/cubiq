# Installation Guide

Cubiq is designed for Windows and uses a robust NSIS-based installer for deployment.

## Installing via NSIS

The standard way to install Cubiq is using the generated `.exe` installer.

1. **Download**: Obtain the latest `cubiq_0.1.0_x64-setup.exe`.
2. **UAC Elevation**: The installer runs in **per-machine** mode (`InstallMode: perMachine`), meaning it installs to `C:\Program Files\cubiq` and requires Administrative privileges.
3. **Components**:
   - **Main App**: The GUI executable.
   - **CLI**: A sidecar binary moved to `C:\Program Files\cubiq\cli\cubiq.exe`.
4. **PATH Modification**: The installer safely appends the CLI directory to the system `PATH` environment variable.

## Verifying the Installation

After installation, open a **new** PowerShell or Command Prompt window and run:

```powershell
# Check if the binary is found
where.exe cubiq

# Check the application status
cubiq status
```

### PATH Behavior

- The installer modifies the `HKLM` (System) environment variables.
- It uses a broadcast signal (`WM_SETTINGCHANGE`) to notify the system of the change.
- **Note**: Existing terminal sessions will not see the updated `PATH`. You must restart your terminal or environment (e.g., VS Code) to pick up the changes.

## Uninstalling

Cubiq can be uninstalled via the Windows "Apps & Features" menu.

- **Cleanup**: The uninstaller removes the main application files and the `cli` subdirectory.
- **PATH Removal**: It safely removes the Cubiq entry from your system `PATH`.
- **Database**: By default, the uninstaller **does not** remove your database at `%APPDATA%\com.cubiq.desktop\cubiq.db` to prevent accidental data loss. You must delete this manually if you want a clean slate.

## Common Installation Problems

### `makensis` missing
If you are building the installer from source and encounter this error, ensure you have **NSIS** installed and added to your `PATH`. Cubiq requires NSIS for the `pnpm tauri build` step.

### PATH not updating
If `cubiq` is not recognized after installation:
1. Ensure you opened a **new** terminal window.
2. Check if `C:\Program Files\cubiq\cli` exists.
3. Manually check your System Environment Variables to see if the entry was added.

### Permissions
Since Cubiq installs to `Program Files`, you must have administrator rights. If the installer fails to write files, ensure you are running it as an Administrator.

## Build Artifacts
When building from source, the installer is produced at:
`src-tauri/target/release/bundle/nsis/cubiq_0.1.0_x64-setup.exe`
