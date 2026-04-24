!include "LogicLib.nsh"

Var CliDir

; --- Correctly broadcast WM_SETTINGCHANGE (0x001A) to HWND_BROADCAST (0xFFFF) ---
Function BroadcastEnvChange
  DetailPrint "Cubiq: Broadcasting environment change..."
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x001A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

Function un.BroadcastEnvChange
  DetailPrint "Cubiq: Broadcasting environment change (Uninstall)..."
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x001A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

; --- Safe AddToPath (HKLM) ---
; $0 = directory to add
Function AddToPath
  Exch $0 ; directory to add
  Push $1 ; original path
  Push $2 ; new path
  Push $3 ; temporary

  DetailPrint "Cubiq: Safely updating HKLM PATH with $0..."
  SetRegView 64
  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  
  ${If} $1 == ""
    DetailPrint "Cubiq: CRITICAL - Could not read existing PATH or it is empty. Skipping update to avoid clobbering."
    Goto done
  ${EndIf}

  ; Boundary-safe check: Search for ";$0;" inside ";$PATH;"
  StrCpy $2 ";$1;"
  Push $2
  Push ";$0;"
  Call StrContains
  Pop $3
  ${If} $3 == "1"
    DetailPrint "Cubiq: Path entry already exists. Skipping."
    Goto done
  ${EndIf}

  ; Append logic
  StrCpy $2 "$1"
  StrLen $3 "$1"
  ${If} $3 > 0
    ; Ensure we have a separator if needed
    StrCpy $3 "$2" 1 -1
    ${If} $3 != ";"
      StrCpy $2 "$2;"
    ${EndIf}
  ${EndIf}
  
  StrCpy $2 "$2$0"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$2"
  Call BroadcastEnvChange
  DetailPrint "Cubiq: PATH updated successfully."

done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; --- Safe RemoveFromPath (HKLM) ---
; $0 = directory to remove
Function un.RemoveFromPath
  Exch $0 ; directory to remove
  Push $1 ; original path
  Push $2 ; new path
  Push $3 ; temporary
  Push $4 ; length check

  DetailPrint "Cubiq: Attempting to remove $0 from HKLM PATH..."
  SetRegView 64
  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  
  ${If} $1 == ""
    DetailPrint "Cubiq: CRITICAL - Could not read existing PATH or it is empty. Skipping uninstall cleanup."
    Goto done
  ${EndIf}

  StrLen $3 $1
  DetailPrint "Cubiq: Original PATH length: $3"

  ${If} $0 == ""
    DetailPrint "Cubiq: ERROR - Target path for removal is empty."
    Goto done
  ${EndIf}

  ; Robust boundary-safe removal
  StrCpy $2 ";$1;"
  
  Push $2
  Push ";$0;"
  Push ";"
  Call un.StrReplaceAll
  Pop $2

  ; Strip leading/trailing semicolons if we added them
  StrCpy $3 $2 1
  ${If} $3 == ";"
    StrCpy $2 $2 "" 1
  ${EndIf}
  StrCpy $3 $2 1 -1
  ${If} $3 == ";"
    StrCpy $2 $2 -1
  ${EndIf}

  StrLen $4 $2
  DetailPrint "Cubiq: New PATH length: $4"

  ; --- SAFETY CHECKS ---
  ${If} $2 == ""
    DetailPrint "Cubiq: CRITICAL - New PATH would be empty. Aborting write."
    Goto done
  ${EndIf}

  ${If} $4 < 20
    DetailPrint "Cubiq: CRITICAL - New PATH is suspiciously short ($4 chars). Aborting write."
    Goto done
  ${EndIf}

  ; Check for essential system paths to ensure we haven't corrupted the string
  Push $2
  Push "C:\Windows\System32"
  Call un.StrContains
  Pop $3
  ${If} $3 == "0"
    Push $2
    Push "%SystemRoot%\System32"
    Call un.StrContains
    Pop $3
    ${If} $3 == "0"
      DetailPrint "Cubiq: CRITICAL - Essential system paths missing in new PATH. Aborting write."
      Goto done
    ${EndIf}
  ${EndIf}

  ${If} $1 == $2
    DetailPrint "Cubiq: PATH entry not found or no changes needed."
    Goto done
  ${EndIf}

  DetailPrint "Cubiq: Writing updated PATH to HKLM..."
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$2"
  Call un.BroadcastEnvChange
  DetailPrint "Cubiq: PATH entry removed successfully."

done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; --- StrContains (Helper) ---
Function StrContains
  Exch $1 ; needle
  Exch
  Exch $0 ; haystack
  Push $2
  Push $3
  Push $4
  Push $5

  StrLen $2 $0
  StrLen $3 $1
  StrCpy $4 0

  loop:
    StrCpy $5 $0 $3 $4
    StrCmp $5 $1 found
    IntOp $4 $4 + 1
    IntCmp $4 $2 notfound notfound loop

  found:
    StrCpy $0 "1"
    Goto done
  notfound:
    StrCpy $0 "0"
  done:
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

Function un.StrContains
  Exch $1 ; needle
  Exch
  Exch $0 ; haystack
  Push $2
  Push $3
  Push $4
  Push $5

  StrLen $2 $0
  StrLen $3 $1
  StrCpy $4 0

  loop:
    StrCpy $5 $0 $3 $4
    StrCmp $5 $1 found
    IntOp $4 $4 + 1
    IntCmp $4 $2 notfound notfound loop

  found:
    StrCpy $0 "1"
    Goto done
  notfound:
    StrCpy $0 "0"
  done:
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

; --- StrReplaceAll (Helper) ---
Function un.StrReplaceAll
  Exch $2 ; replacement
  Exch
  Exch $1 ; needle
  Exch 2
  Exch $0 ; haystack
  Push $3
  Push $4
  Push $5

  StrCpy $3 ""
  loop:
    StrLen $5 $1
    StrCpy $4 $0 $5
    StrCmp $4 $1 found
    StrCpy $4 $0 1
    StrCpy $3 "$3$4"
    StrCpy $0 $0 "" 1
    StrCmp $0 "" done loop
  found:
    StrCpy $3 "$3$2"
    StrCpy $0 $0 "" $5
    StrCmp $0 "" done loop
  done:
    StrCpy $0 "$3$0"
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $CliDir "$INSTDIR\cli"
  DetailPrint "Cubiq: Post-install CLI setup starting..."

  ${If} ${FileExists} "$CliDir\cubiq.exe"
    DetailPrint "Cubiq: CLI already installed at $CliDir\cubiq.exe. Checking PATH."
    Goto post_cli_setup
  ${EndIf}

  CreateDirectory "$CliDir"

  ${If} ${FileExists} "$INSTDIR\cubiq-cli.exe"
    DetailPrint "Cubiq: Found $INSTDIR\cubiq-cli.exe, moving to $CliDir\cubiq.exe"
    CopyFiles /SILENT "$INSTDIR\cubiq-cli.exe" "$CliDir\cubiq.exe"
    Delete "$INSTDIR\cubiq-cli.exe"
  ${ElseIf} ${FileExists} "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe"
    DetailPrint "Cubiq: Found $INSTDIR\cubiq-x86_64-pc-windows-msvc.exe, moving to $CliDir\cubiq.exe"
    CopyFiles /SILENT "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe" "$CliDir\cubiq.exe"
    Delete "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe"
  ${Else}
    DetailPrint "Cubiq: No CLI sidecar found in $INSTDIR."
  ${EndIf}

post_cli_setup:
  ${If} ${FileExists} "$CliDir\cubiq.exe"
    Push "$CliDir"
    Call AddToPath
  ${EndIf}
  DetailPrint "Cubiq: Post-install CLI setup complete."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy $CliDir "$INSTDIR\cli"
  DetailPrint "Cubiq: Post-uninstall CLI cleanup starting..."
  
  Push "$CliDir"
  Call un.RemoveFromPath

  Delete "$CliDir\cubiq.exe"
  RMDir "$CliDir"
  
  DetailPrint "Cubiq: Post-uninstall CLI cleanup complete."
!macroend