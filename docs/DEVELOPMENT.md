# Development Guide

This guide explains how to set up the environment and build Cubiq from source.

## Prerequisites

- **Node.js** & **pnpm**: For the frontend and Tauri CLI.
- **Rust**: The latest stable version via `rustup`.
- **MSVC Toolchain**: Required for Windows builds (Visual Studio with "Desktop development with C++").
- **WebView2**: Standard on modern Windows, but required for the Tauri window.
- **NSIS**: Required for building the Windows installer.

## Repository Layout

- `src/`: Frontend code (React + TypeScript + Vite).
- `src-tauri/`: Backend code (Rust).
  - `src/main.rs`: Main GUI application entry point.
  - `src/bin/cubiq.rs`: CLI application entry point.
  - `src/lib.rs`: Shared logic (Database, AI clients, Models).
  - `nsis/`: Custom installer scripts and hooks.
- `scripts/`: Utility scripts for building and patching.

## Development Workflow

### 1. Initial Setup

```powershell
pnpm install
```

### 2. Running in Dev Mode

This launches the GUI with Hot Module Replacement (HMR).

```powershell
pnpm tauri dev
```

### 3. Running the CLI in Dev

You can run the CLI via Cargo:

```powershell
cd src-tauri
cargo run --bin cubiq-cli -- status
```

## Building a Release

Building Cubiq for distribution requires a specific two-step process to ensure the CLI is correctly bundled as a sidecar.

### Step 1: Build the CLI Sidecar

The CLI must be built first and placed in the expected location for Tauri.

```powershell
.\scripts\build-cli-sidecar.ps1
```

This script:

1. Compiles `cubiq-cli` in release mode.
2. Copies it to `src-tauri/binaries/cubiq-cli-x86_64-pc-windows-msvc.exe`.

### Step 2: Build the Main App and Installer

```powershell
pnpm tauri build
```

The output installer will be located at:
`src-tauri/target/release/bundle/nsis/cubiq_0.1.0_x64-setup.exe`

## Debugging Tips

### Logs

Cubiq uses `tauri-plugin-log`. Logs are stored in:
`%APPDATA%\com.cubiq.desktop\logs\app.log`

### DevTools

In `dev` mode, you can right-click anywhere in the GUI and select **Inspect** to open the Chrome DevTools. This works for both the Main window and the QuickAsk popup.

### Common Gotchas (Tauri v2)

- **Permissions**: Tauri v2 uses a new capability system. Check `src-tauri/capabilities/` if you encounter "Command not allowed" errors.
- **External Binaries**: The CLI is an `externalBin` in `tauri.conf.json`. If it's missing, the build will fail. Always run the sidecar script first.
