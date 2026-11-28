---
"@domicile-desktop/engine": patch
"domicile": patch
---

The engine logs what it gets past as warnings, not errors: GCM failing to reach its MCS endpoint while the network is down or changing, a page's WebRTC host lookup failing, and libinput's reports of a kernel's or device's fault, such as a touchpad's touch jump. libinput's client bugs stay errors.

An Electron app's session finds its storage while the shell's first page is still opening, so an app started at login no longer logs "the engine named no storage path for a session: there is no shell".
