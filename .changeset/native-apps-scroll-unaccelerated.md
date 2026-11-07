---
"@domicile-desktop/engine": patch
"@domicile-desktop/sdk": patch
"domicile": patch
---

Stop touchpad flicks in native apps from scrolling far past where you aimed. Native apps get libinput's scroll distance and run their own momentum; scroll acceleration now applies to pages only.
