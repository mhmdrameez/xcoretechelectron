!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var Dialog
Var TextName
Var TextPhone

Var NameValue
Var PhoneValue

!macro customHeader
  Page custom customPageCreate customPageLeave
!macroend

Function customPageCreate
  nsDialogs::Create 1011
  Pop $Dialog

  ${If} $Dialog == error
    Abort
  ${EndIf}

  ; Use a very compact layout to ensure visibility
  ${NSD_CreateLabel} 0 0 100% 12u "Customer Details (Required for Service Support)"
  Pop $0

  ${NSD_CreateLabel} 0 25u 30% 12u "Your Name:"
  Pop $0
  ${NSD_CreateText} 35% 24u 60% 12u ""
  Pop $TextName

  ${NSD_CreateLabel} 0 45u 30% 12u "Phone Number:"
  Pop $0
  ${NSD_CreateText} 35% 44u 60% 12u ""
  Pop $TextPhone

  ${NSD_CreateLabel} 0 75u 100% 24u "Privacy Notice: Your data is used only for service tracking by Ramee Z and is kept strictly confidential."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function customPageLeave
  ${NSD_GetText} $TextName $NameValue
  ${NSD_GetText} $TextPhone $PhoneValue

  ; Validation
  ${If} $NameValue == ""
    MessageBox MB_ICONEXCLAMATION "Please enter your Name to continue."
    Abort
  ${EndIf}
  ${If} $PhoneValue == ""
    MessageBox MB_ICONEXCLAMATION "Please enter your Phone Number to continue."
    Abort
  ${EndIf}

  ; Create directory if not exists
  CreateDirectory "$APPDATA\XCoreTech Disk Cleaner"

  ; Write profile.json
  FileOpen $0 "$APPDATA\XCoreTech Disk Cleaner\profile.json" w
  FileWrite $0 "{"
  FileWrite $0 '$\"name$\": $\"$NameValue$\", '
  FileWrite $0 '$\"phone$\": $\"$PhoneValue$\", '
  FileWrite $0 '$\"tracking$\": true'
  FileWrite $0 "}"
  FileClose $0
FunctionEnd
