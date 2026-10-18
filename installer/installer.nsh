; Extra steps for the NSIS installer (included via build.nsis.include).

; Windows keeps a cache of shortcut icons, so after an update the desktop and
; Start menu shortcuts can keep showing the previous version's icon. Tell the
; shell that file associations/icons changed so it redraws them.
!macro customInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
