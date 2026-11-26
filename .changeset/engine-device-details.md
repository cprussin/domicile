---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/app-settings": minor
"@domicile-desktop/e2e-harness": patch
"domicile": minor
---

The engine hides the device's details from pages, as Brave farbles them: a
canvas's exported pixels, what an `OfflineAudioContext` renders and
`navigator.hardwareConcurrency` come out a little off, the same way for one
site all session and differently for each site and each start. Off reads the
truth. Each profile's new `protections.hide_device_details`, on unless set
`false`, turns it off, and Settings › Privacy has its switch, "Hide your
device's details".
