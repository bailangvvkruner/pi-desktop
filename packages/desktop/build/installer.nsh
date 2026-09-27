; Old clients invoke updates with --updated but without /S. Make that path
; silent too, while retaining the normal wizard for a manually opened installer.
!macro customInit
  ${If} ${isUpdated}
    SetSilent silent
  ${EndIf}
!macroend
