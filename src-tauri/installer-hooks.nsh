!define LEGACY_INSTALL_KEY "Software\0f7e2335-0fae-5554-8f8f-93ac69b9f97d"
!define LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\0f7e2335-0fae-5554-8f8f-93ac69b9f97d"

; Replace the previous Electron installation instead of leaving two copies of
; CATS Configurator. The Electron uninstaller's update flags retain user data.
!macro NSIS_HOOK_PREINSTALL
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4

  SetRegView 64
  ReadRegStr $R0 HKCU "${LEGACY_INSTALL_KEY}" "InstallLocation"
  ReadRegStr $R1 HKCU "${LEGACY_UNINSTALL_KEY}" "UninstallString"

  ; Older 32-bit packages used the same application identity.
  ${If} "$R0$R1" == ""
    SetRegView 32
    ReadRegStr $R0 HKCU "${LEGACY_INSTALL_KEY}" "InstallLocation"
    ReadRegStr $R1 HKCU "${LEGACY_UNINSTALL_KEY}" "UninstallString"
  ${EndIf}

  ${If} "$R0$R1" == ""
    Goto cats_legacy_install_done
  ${EndIf}

  ${If} $R0 == ""
  ${OrIf} $R1 == ""
    StrCpy $R4 "An earlier CATS Configurator installation was found, but its uninstall information is incomplete. Remove it from Windows Installed apps, then run this installer again."
    Goto cats_legacy_install_failed
  ${EndIf}

  StrCpy $R2 "$R0\Uninstall CATS Configurator.exe"
  ${IfNot} ${FileExists} "$R2"
    StrCpy $R4 "An earlier CATS Configurator installation was found, but its uninstaller is missing. Remove it from Windows Installed apps, then run this installer again."
    Goto cats_legacy_install_failed
  ${EndIf}

  !insertmacro CheckIfAppIsRunning "CATS Configurator.exe" "CATS Configurator"

  InitPluginsDir
  ClearErrors
  CopyFiles /SILENT "$R2" "$PLUGINSDIR\cats-configurator-electron-uninstaller.exe"
  ${If} ${Errors}
    StrCpy $R4 "The earlier CATS Configurator installation could not be prepared for removal. Close the app and run this installer again."
    Goto cats_legacy_install_failed
  ${EndIf}

  ClearErrors
  ExecWait '"$PLUGINSDIR\cats-configurator-electron-uninstaller.exe" /S /KEEP_APP_DATA --updated _?=$R0' $R3
  ${If} ${Errors}
  ${OrIf} $R3 != 0
    StrCpy $R4 "The earlier CATS Configurator installation could not be removed. Remove it from Windows Installed apps, then run this installer again."
    Goto cats_legacy_install_failed
  ${EndIf}

  ReadRegStr $R1 HKCU "${LEGACY_UNINSTALL_KEY}" "UninstallString"
  ${If} $R1 != ""
    StrCpy $R4 "The earlier CATS Configurator installation did not finish uninstalling. Restart Windows, then run this installer again."
    Goto cats_legacy_install_failed
  ${EndIf}

  cats_legacy_install_done:
    SetRegView 64
    Pop $R4
    Pop $R3
    Pop $R2
    Pop $R1
    Pop $R0
    Goto cats_legacy_install_finished

  cats_legacy_install_failed:
    DetailPrint "$R4"
    IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$R4"
    SetErrorLevel 1
    Quit

  cats_legacy_install_finished:
!macroend
