# scripts/patch-nsis.ps1
# Patches Tauri-generated NSIS installer to:
# - RequestExecutionLevel admin
# - InstallDir "$PROGRAMFILES64\Cubiq"
# - Kill running cubiq.exe before install
# - Copy CLI sidecar into $INSTDIR\cli\cubiq.exe
# - Add $INSTDIR\cli to machine PATH (HKLM)
# - Remove PATH entry on uninstall
# Idempotent: safe to re-run.

$ErrorActionPreference = "Stop"

function Find-InstallerNsi {
    $candidates = @(
        "src-tauri\target\release\nsis\x64\installer.nsi",
        "src-tauri\target\release\nsis\installer.nsi",
        "src-tauri\target\release\bundle\nsis\installer.nsi"
    )

    foreach ($p in $candidates) {
        if (Test-Path $p) { return (Resolve-Path $p).Path }
    }

    # fallback: search
    $found = Get-ChildItem -Path "src-tauri\target\release" -Recurse -Filter "installer.nsi" -ErrorAction SilentlyContinue |
    Select-Object -First 1
    if ($null -ne $found) { return $found.FullName }

    throw "Could not find installer.nsi. Run 'pnpm tauri build' first."
}

$installerPath = Find-InstallerNsi
Write-Host "Patching: $installerPath"

$content = Get-Content -LiteralPath $installerPath -Raw

$markerBegin = "; ===== CUBIQ_CUSTOM_PATCH_BEGIN ====="
$markerEnd = "; ===== CUBIQ_CUSTOM_PATCH_END ====="

if ($content -match [regex]::Escape($markerBegin)) {
    Write-Host "Already patched. Nothing to do."
    exit 0
}

# 1) Ensure x64.nsh include (needed for $PROGRAMFILES64 on some setups)
if ($content -notmatch '!\s*include\s+"x64\.nsh"') {
    # insert after first include block (MUI2/LogicLib/etc)
    $content = $content -replace '(!include\s+"MUI2\.nsh"\s*\r?\n)', "`$1!include `"x64.nsh`"`r`n"
}

# 2) Force admin
if ($content -match 'RequestExecutionLevel\s+\w+') {
    $content = $content -replace 'RequestExecutionLevel\s+\w+', 'RequestExecutionLevel admin'
}
else {
    # insert near top after includes
    $content = $content -replace '(!include\s+".+?"\s*\r?\n)+', "$0`r`nRequestExecutionLevel admin`r`n"
}

# 3) Force Program Files default install dir
# Tauri-generated scripts normally set InstallDir to LocalAppData. Replace whatever is there.
if ($content -match 'InstallDir\s+".*?"') {
    $content = $content -replace 'InstallDir\s+".*?"', 'InstallDir "$PROGRAMFILES64\Cubiq"'
}
else {
    # insert after RequestExecutionLevel
    $content = $content -replace '(RequestExecutionLevel\s+admin\s*\r?\n)', "`$1InstallDir `"$PROGRAMFILES64\Cubiq`"`r`n"
}

# 4) Inject our hook macros + helper functions
$patch = @"
$markerBegin

!include "LogicLib.nsh"

Var CliDir
Var CliExe

Function BroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

Function un.BroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

; --- AddToPath (HKLM, RegView 64) ---
Function AddToPath
  Exch \$0
  Push \$1
  Push \$2

  SetRegView 64
  ReadRegStr \$1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  ; already present?
  ; crude but effective: look for ;dir or dir; or exact
  StrCpy \$2 ";\$1;"
  ${IfThen} "\$2" == ";;" ${|} StrCpy \$2 "" ${|}
  ${If} "\$2" != ""
    ${If} "\$2" == ";\$0;"
      Goto done
    ${EndIf}
    ${IfThen} "\$2" != "" ${|} ${If} "\$2" != "" ${|}
  ${EndIf}

  ; If PATH empty, set it directly
  ${If} "\$1" == ""
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "\$0"
    Call BroadcastEnvChange
    Goto done
  ${EndIf}

  ; If substring exists, skip (simple check)
  StrCpy \$2 "\$1"
  Push "\$2"
  Push "\$0"
  Call _StrContains
  Pop \$2
  ${If} "\$2" == "1"
    Goto done
  ${EndIf}

  ; append with semicolon if needed
  StrCpy \$2 "\$1" 1 -1
  ${If} "\$2" != ";"
    StrCpy \$1 "\$1;"
  ${EndIf}
  StrCpy \$1 "\$1\$0"

  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "\$1"
  Call BroadcastEnvChange

done:
  Pop \$2
  Pop \$1
FunctionEnd

; --- RemoveFromPath (HKLM, RegView 64) ---
Function un.RemoveFromPath
  Exch \$0
  Push \$1

  SetRegView 64
  ReadRegStr \$1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  ${If} "\$1" == ""
    Goto done
  ${EndIf}

  ; remove ;dir
  Push "\$1"
  Push ";\$0"
  Push ""
  Call un._StrReplaceAll
  Pop \$1

  ; remove dir;
  Push "\$1"
  Push "\$0;"
  Push ""
  Call un._StrReplaceAll
  Pop \$1

  ; remove dir
  Push "\$1"
  Push "\$0"
  Push ""
  Call un._StrReplaceAll
  Pop \$1

  ; cleanup double ;;
  Push "\$1"
  Push ";;"
  Push ";"
  Call un._StrReplaceAll
  Pop \$1

  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "\$1"
  Call un.BroadcastEnvChange

done:
  Pop \$1
FunctionEnd

; --- substring contains helper (returns 1/0) ---
Function _StrContains
  Exch \$1 ; needle
  Exch
  Exch \$0 ; haystack
  Push \$2
  Push \$3
  StrCpy \$2 0
  StrLen \$3 \$1
  loop:
    StrCpy \$2 "\$0" "" \$2
    StrCpy \$2 "\$2" \$3
    StrCmp "\$2" "\$1" found
    IntOp \$2 \$2 + 1
    StrLen \$3 "\$0"
    IntCmp \$2 \$3 notfound
    Goto loop
  found:
    StrCpy \$0 "1"
    Goto done
  notfound:
    StrCpy \$0 "0"
  done:
    Pop \$3
    Pop \$2
    Pop \$1
    Exch \$0
FunctionEnd

; --- ReplaceAll helper (uninstall-safe copy) ---
Function un._StrReplaceAll
  Exch \$2 ; replacement
  Exch
  Exch \$1 ; needle
  Exch 2
  Exch \$0 ; haystack
  Push \$3
  Push \$4
  Push \$5

  StrCpy \$3 ""
  loop:
    StrCmp \$0 "" done
    StrLen \$5 \$1
    StrCpy \$4 \$0 \$5
    StrCmp \$4 \$1 found
    StrCpy \$4 \$0 1
    StrCpy \$3 "\$3\$4"
    StrCpy \$0 \$0 "" 1
    Goto loop
  found:
    StrCpy \$3 "\$3\$2"
    StrCpy \$0 \$0 "" \$5
    Goto loop
  done:
    StrCpy \$0 "\$3\$0"
    Pop \$5
    Pop \$4
    Pop \$3
    Pop \$2
    Pop \$1
    Exch \$0
FunctionEnd

; --- Hooks that Tauri calls (if present) ---
!macro NSIS_HOOK_PREINSTALL
  ; kill running GUI so Program Files overwrite works
  nsExec::ExecToLog 'taskkill /F /IM cubiq.exe'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy \$CliDir "\$INSTDIR\cli"
  StrCpy \$CliExe "\$CliDir\cubiq.exe"
  CreateDirectory "\$CliDir"

  ; Sidecar produced by your build script + externalBin config
  ${If} ${FileExists} "\$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe"
    CopyFiles /SILENT "\$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe" "\$CliExe"
  ${ElseIf} ${FileExists} "\$INSTDIR\cubiq-cli.exe"
    CopyFiles /SILENT "\$INSTDIR\cubiq-cli.exe" "\$CliExe"
  ${EndIf}

  Push "\$CliDir"
  Call AddToPath
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy \$CliDir "\$INSTDIR\cli"
  Push "\$CliDir"
  Call un.RemoveFromPath
!macroend

$markerEnd
"@

# Append at end (simple + robust)
$content = $content.TrimEnd() + "`r`n`r`n" + $patch + "`r`n"

Set-Content -LiteralPath $installerPath -Value $content -Encoding UTF8
Write-Host "Patched successfully."

Write-Host ""
Write-Host "Next: rebuild the installer EXE by re-running:"
Write-Host "  pnpm tauri build"