; Old clients invoke updates with --updated but without /S. Make that path
; silent too, while retaining the normal wizard for a manually opened installer.
!macro customInit
  ${If} ${isUpdated}
    SetSilent silent
  ${EndIf}
!macroend

; ShellExecute (including Explorer's address bar) resolves App Paths immediately.
; Keep this registration in the same user/machine scope as the installation;
; no PATH change or Explorer restart is necessary.
!define PAI_APP_PATHS_ROOT "Software\Microsoft\Windows\CurrentVersion\App Paths"
!define PAI_APP_PATH_KEY "${PAI_APP_PATHS_ROOT}\pai.exe"
!define PAI_MANAGED_VALUE "dev.pidesktop.app"

!macro customInstall
  !if "${PRODUCT_NAME}" == "Pi Desktop"
    Push $0
    Push $1
    Push $2
    ; ReadRegStr alone cannot distinguish a missing key from an existing key
    ; without a default value. Preserve either kind of foreign registration.
    StrCpy $0 0
    StrCpy $2 ""
    ${Do}
      ClearErrors
      EnumRegKey $1 SHCTX "${PAI_APP_PATHS_ROOT}" $0
      ${If} ${Errors}
        ${ExitDo}
      ${EndIf}
      ${If} $1 == "pai.exe"
        StrCpy $2 "exists"
        ${ExitDo}
      ${EndIf}
      IntOp $0 $0 + 1
    ${Loop}
    ReadRegStr $1 SHCTX "${PAI_APP_PATH_KEY}" "PiDesktopManaged"
    ${If} $2 != "exists"
    ${OrIf} $1 == "${PAI_MANAGED_VALUE}"
      WriteRegStr SHCTX "${PAI_APP_PATH_KEY}" "" "$INSTDIR\bin\pai.exe"
      WriteRegStr SHCTX "${PAI_APP_PATH_KEY}" "PiDesktopManaged" "${PAI_MANAGED_VALUE}"
    ${EndIf}
    Pop $2
    Pop $1
    Pop $0
  !endif
!macroend

!macro customUnInstall
  !if "${PRODUCT_NAME}" == "Pi Desktop"
    Push $0
    Push $1
    ReadRegStr $0 SHCTX "${PAI_APP_PATH_KEY}" "PiDesktopManaged"
    ReadRegStr $1 SHCTX "${PAI_APP_PATH_KEY}" ""
    ; Another install may have taken ownership since this copy was installed.
    ${If} $0 == "${PAI_MANAGED_VALUE}"
    ${AndIf} $1 == "$INSTDIR\bin\pai.exe"
      DeleteRegKey SHCTX "${PAI_APP_PATH_KEY}"
    ${EndIf}
    Pop $1
    Pop $0
  !endif
!macroend
