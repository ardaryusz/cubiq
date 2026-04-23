$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$tauriDir = Join-Path $repoRoot "src-tauri"
$sidecarDir = Join-Path $tauriDir "binaries"
$sidecarOut = Join-Path $sidecarDir "cubiq-cli-x86_64-pc-windows-msvc.exe"
$binOut = Join-Path $tauriDir "target\release\cubiq-cli.exe"

Write-Host "Repo root: $repoRoot"

# 1) Ensure sidecar dir exists
New-Item -ItemType Directory -Force -Path $sidecarDir | Out-Null

# 2) Create placeholder sidecar so Tauri build script stops complaining
if (!(Test-Path $sidecarOut)) {
  Write-Host "Creating placeholder sidecar to satisfy Tauri build checks..."
  New-Item -ItemType File -Force -Path $sidecarOut | Out-Null
}

# 3) Build CLI
Write-Host "Building CLI (release)..."
Set-Location $tauriDir
cargo build --release --bin cubiq-cli

if (!(Test-Path $binOut)) {
  throw "Build succeeded but CLI not found at: $binOut"
}

# 4) Overwrite placeholder with real binary
Write-Host "Copying CLI to sidecar path:"
Write-Host "  From: $binOut"
Write-Host "  To:   $sidecarOut"
Copy-Item $binOut $sidecarOut -Force

Write-Host "Done. Sidecar is ready:"
Write-Host "  $sidecarOut"