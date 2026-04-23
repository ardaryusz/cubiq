!include "LogicLib.nsh"

Var CliDir

Function BroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

Function un.BroadcastEnvChange
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i 0x1A, p 0, w "Environment", i 0, i 2000, *p .r0)'
FunctionEnd

; --- AddToPath (HKLM, RegView 64) ---
Function AddToPath
  Exch $0
  Push $1
  Push $2

  SetRegView 64
  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  ; check if already in path...
  StrCpy $2 ";$1;"
  ${IfThen} "$2" == ";;" ${|} StrCpy $2 "" ${|}
  ${If} "$2" != ""
    ${If} "$2" == ";$0;"
      Goto done
    ${EndIf}
  ${EndIf}

  ${If} "$1" == ""
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0"
    Call BroadcastEnvChange
    Goto done
  ${EndIf}

  StrCpy $2 "$1"
  Push "$2"
  Push "$0"
  Call _StrContains
  Pop $2
  ${If} "$2" == "1"
    Goto done
  ${EndIf}

  StrCpy $2 "$1" 1 -1
  ${If} "$2" != ";"
    StrCpy $1 "$1;"
  ${EndIf}
  StrCpy $1 "$1$0"

  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$1"
  Call BroadcastEnvChange

done:
  Pop $2
  Pop $1
FunctionEnd

; --- RemoveFromPath (HKLM, RegView 64) ---
Function un.RemoveFromPath
  Exch $0
  Push $1

  SetRegView 64
  ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  ${If} "$1" == ""
    Goto done
  ${EndIf}

  Push "$1"
  Push ";$0"
  Push ""
  Call un._StrReplaceAll
  Pop $1

  Push "$1"
  Push "$0;"
  Push ""
  Call un._StrReplaceAll
  Pop $1

  Push "$1"
  Push "$0"
  Push ""
  Call un._StrReplaceAll
  Pop $1

  Push "$1"
  Push ";;"
  Push ";"
  Call un._StrReplaceAll
  Pop $1

  WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$1"
  Call un.BroadcastEnvChange

done:
  Pop $1
FunctionEnd

Function _StrContains
  Exch $1 ; needle
  Exch
  Exch $0 ; haystack
  Push $2
  Push $3
  StrCpy $2 0
  StrLen $3 $1
  loop:
    StrCpy $2 "$0" "" $2
    StrCpy $2 "$2" $3
    StrCmp "$2" "$1" found
    IntOp $2 $2 + 1
    StrLen $3 "$0"
    IntCmp $2 $3 notfound
    Goto loop
  found:
    StrCpy $0 "1"
    Goto done
  notfound:
    StrCpy $0 "0"
  done:
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

Function un._StrReplaceAll
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
    StrCmp $0 "" done
    StrLen $5 $1
    StrCpy $4 $0 $5
    StrCmp $4 $1 found
    StrCpy $4 $0 1
    StrCpy $3 "$3$4"
    StrCpy $0 $0 "" 1
    Goto loop
  found:
    StrCpy $3 "$3$2"
    StrCpy $0 $0 "" $5
    Goto loop
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
    DetailPrint "Cubiq: CLI already installed at $CliDir\cubiq.exe, skipping copy."
    Goto post_cli_setup
  ${EndIf}

  CreateDirectory "$CliDir"

  ; Try cubiq-cli.exe (renamed by Tauri if using externalBin: ["binaries/cubiq-cli"])
  ${If} ${FileExists} "$INSTDIR\cubiq-cli.exe"
    DetailPrint "Cubiq: Found $INSTDIR\cubiq-cli.exe, copying to $CliDir\cubiq.exe"
    CopyFiles /SILENT "$INSTDIR\cubiq-cli.exe" "$CliDir\cubiq.exe"
    Delete "$INSTDIR\cubiq-cli.exe"
    Goto post_copy
  ${EndIf}

  ; Try sidecar full name (sometimes preserved)
  ${If} ${FileExists} "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe"
    DetailPrint "Cubiq: Found $INSTDIR\cubiq-x86_64-pc-windows-msvc.exe, copying to $CliDir\cubiq.exe"
    CopyFiles /SILENT "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe" "$CliDir\cubiq.exe"
    Delete "$INSTDIR\cubiq-x86_64-pc-windows-msvc.exe"
    Goto post_copy
  ${EndIf}

  DetailPrint "Cubiq: No CLI sidecar found in $INSTDIR to install."
  Goto post_cli_setup

post_copy:
  DetailPrint "Cubiq: CLI copied successfully."

post_cli_setup:
  DetailPrint "Cubiq: Updating PATH with $CliDir"
  Push "$CliDir"
  Call AddToPath
  DetailPrint "Cubiq: Post-install CLI setup complete."
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCpy $CliDir "$INSTDIR\cli"
  Push "$CliDir"
  Call un.RemoveFromPath

  ; Clean up the moved CLI binary and directory
  Delete "$CliDir\cubiq.exe"
  RMDir "$CliDir"
!macroend