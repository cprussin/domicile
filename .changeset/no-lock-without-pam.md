---
"domicile": minor
"@domicile-desktop/sdk": patch
"@domicile-desktop/site": patch
"@domicile-desktop/distro": patch
---

A desktop whose machine lacks the lock's PAM service, such as a `nix run` trial, does not lock: locked, nothing could unlock it. An urgent notification, "This screen won't lock", says so at startup, and the log names the file to add. Adding it turns the lock on with no restart. The Manganese page notes this under its trial command.
