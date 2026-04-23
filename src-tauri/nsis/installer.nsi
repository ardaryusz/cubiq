; ============================================================
; Cubiq NSIS installer template (Tauri v2 compatible)
; - Keeps Tauri's default install/uninstall logic
; - Defaults to per-machine install dir: $PROGRAMFILES64\Cubiq
; - Requires admin (so Program Files + HKLM PATH works)
; - Installs CLI sidecar into: $INSTDIR\cli\cubiq.exe
; - Adds $INSTDIR\cli to PATH (per-machine)
; - Removes it on uninstall
; - Kills running Cubiq/cubiq-cli before file copy to avoid "file in use"
; ============================================================

!include "MUI2.nsh"
!include "LogicLib.nsh"

; ---------- Require admin for Program Files + per-machine PATH ----------
RequestExecutionLevel admin

; ---------- Default install directory ----------
InstallDir "$PROGRAMFILES64\Cubiq"

; ---------- Variables ----------
Var CliDir
Var CliExe
Var PathToAdd

; ---------- Helpers: broadcast env change so new terminals see PATH ----------
Function BroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

Function un.BroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

; ---------- String helper: replace all occurrences ----------
Function StrReplace
  Exch $R2 ; replacement
  Exch
  Exch $R1 ; needle
  Exch 2
  Exch $R0 ; haystack
  Push $R3
  Push $R4
  Push $R5

  StrCpy $R3 ""
loop:
  StrCmp $R0 "" done
  StrLen $R5 $R1
  StrCpy $R4 $R0 $R5
  StrCmp $R4 $R1 found
  StrCpy $R4 $R0 1
  StrCpy $R3 "$R3$R4"
  StrCpy $R0 $R0 "" 1
  Goto loop

found:
  StrCpy $R3 "$R3$R2"
  StrCpy $R0 $R0 "" $R5
  Goto loop

done:
  StrCpy $R0 "$R3$R0"
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function un.StrReplace
  Exch $R2
  Exch
  Exch $R1
  Exch 2
  Exch $R0
  Push $R3
  Push $R4
  Push $R5

  StrCpy $R3 ""
loop:
  StrCmp $R0 "" done
  StrLen $R5 $R1
  StrCpy $R4 $R0 $R5
  StrCmp $R4 $R1 found
  StrCpy $R4 $R0 1
  StrCpy $R3 "$R3$R4"
  StrCpy $R0 $R0 "" 1
  Goto loop

found:
  StrCpy $R3 "$R3$R2"
  StrCpy $R0 $R0 "" $R5
  Goto loop

done:
  StrCpy $R0 "$R3$R0"
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; ---------- Find substring index (returns -1 if not found) ----------
Function StrFind
  Exch $R1 ; needle
  Exch
  Exch $R0 ; haystack
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  StrLen $R2 $R0
  StrLen $R3 $R1
  StrCpy $R4 0

loop:
  IntCmp $R4 $R2 notfound
  StrCpy $R5 $R0 $R3 $R4
  StrCmp $R5 $R1 found
  IntOp $R4 $R4 + 1
  Goto loop

found:
  StrCpy $R0 $R4
  Goto done

notfound:
  StrCpy $R0 -1

done:
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function un.StrFind
  Exch $R1
  Exch
  Exch $R0
  Push $R2
  Push $R3
  Push $R4
  Push $R5

  StrLen $R2 $R0
  StrLen $R3 $R1
  StrCpy $R4 0

loop:
  IntCmp $R4 $R2 notfound
  StrCpy $R5 $R0 $R3 $R4
  StrCmp $R5 $R1 found
  IntOp $R4 $R4 + 1
  Goto loop

found:
  StrCpy $R0 $R4
  Goto done

notfound:
  StrCpy $R0 -1

done:
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; ---------- Path contains helper (returns 1 if already present) ----------
Function StrContainsPath
  Exch $R1 ; path
  Exch
  Exch $R0 ; full PATH string
  Push $R2
  Push $R3

  StrCpy $R2 "$R0"

  ; middle match ";<path>;" or ";<path>" at end
  Push "$R2"
  Push ";$R1;"
  Call StrFind
  Pop $R0
  ${If} $R0 >= 0
    StrCpy $R0 "1"
    Goto done
  ${EndIf}

  Push "$R2"
  Push ";$R1"
  Call StrFind
  Pop $R0
  ${If} $R0 >= 0
    StrCpy $R0 "1"
    Goto done
  ${EndIf}

  ; start match "<path>;" or exact "<path>"
  StrLen $R3 $R1
  StrCpy $R0 "$R2" $R3
  ${If} "$R0" == "$R1"
    StrCpy $R0 "1"
    Goto done
  ${EndIf}

  StrCpy $R0 "0"

done:
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

Function un.StrContainsPath
  Exch $R1
  Exch
  Exch $R0
  Push $R2
  Push $R3

  StrCpy $R2 "$R0"

  Push "$R2"
  Push ";$R1;"
  Call un.StrFind
  Pop $R0
  ${If} $R0 >= 0
    StrCpy $R0 "1"
    Goto done
  ${EndIf}

  Push "$R2"
  Push ";$R1"
  Call un.StrFind
  Pop $R0
  ${If} $R0 >= 0
    StrCpy $R0 "1"
    Goto done
  ${EndIf}

  StrLen $R3 $R1
  StrCpy $R0 "$R2" $R3
  ${If} "$R0" == "$R1"
    StrCpy $R0 "1"
    Goto done
  ${EndIf}

  StrCpy $R0 "0"

done:
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

; ---------- Add to PATH (HKLM) if missing ----------
Function AddToPath
  Exch $0 ; dir to add
  Push $1
  Push $2
  Push $3
  Push $4

  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  StrCpy $2 "$1"
  StrCpy $3 "$0"

  ${If} "$2" == ""
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$3"
    Call BroadcastEnvChange
    Goto done
  ${EndIf}

  Push "$2"
  Push "$3"
  Call StrContainsPath
  Pop $4
  ${If} $4 == "1"
    Goto done
  ${EndIf}

  ; ensure trailing ;
  StrCpy $4 "$2" 1 -1
  ${If} "$4" != ";"
    StrCpy $2 "$2;"
  ${EndIf}

  StrCpy $2 "$2$3"
  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$2"
  Call BroadcastEnvChange

done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

; ---------- Remove from PATH (HKLM) ----------
Function un.RemoveFromPath
  Exch $0 ; dir to remove
  Push $1
  Push $2
  Push $3
  Push $4

  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
  StrCpy $2 "$1"
  StrCpy $3 "$0"

  ${If} "$2" == ""
    Goto done
  ${EndIf}

  ; Remove ;<path>
  Push "$2"
  Push ";$3"
  Push ""
  Call un.StrReplace
  Pop $2

  ; Remove <path>;
  Push "$2"
  Push "$3;"
  Push ""
  Call un.StrReplace
  Pop $2

  ; Remove <path>
  Push "$2"
  Push "$3"
  Push ""
  Call un.StrReplace
  Pop $2

  ; Cleanup double ;;
  Push "$2"
  Push ";;"
  Push ";"
  Call un.StrReplace
  Pop $2

  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$2"
  Call un.BroadcastEnvChange

done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

; ============================================================
; Tauri hooks (THIS is the important part)
; Tauri's generated installer will call these.
; ============================================================

!macro NSIS_HOOK_PREINSTALL
  ; Avoid "Error opening file for writing" if Cubiq is running
  ; (best-effort: ignore errors)
  nsExec::ExecToLog 'taskkill /IM cubiq.exe'
  Sleep 400
  nsExec::ExecToLog 'taskkill /F /IM cubiq.exe'
  nsExec::ExecToLog 'taskkill /F /IM cubiq-cli.exe'
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $CliDir "$INSTDIR\cli"
  StrCpy $CliExe "$CliDir\cubiq.exe"
  StrCpy $PathToAdd "$CliDir"

  CreateDirectory "$CliDir"

  ; sidecar from bundle.externalBin lands in $INSTDIR as:
  ; cubiq-x86_64-pc-windows-msvc.exe
  ${If} ${FileExists} "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe"
    CopyFiles /SILENT "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe" "$CliExe"
  ${ElseIf} ${FileExists} "$INSTDIR\cubiq-cli.exe"
    CopyFiles /SILENT "$INSTDIR\cubiq-cli.exe" "$CliExe"
  ${EndIf}

  Push "$PathToAdd"
  Call AddToPath
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy $CliDir "$INSTDIR\cli"
  Push "$CliDir"
  Call un.RemoveFromPath
!macroend