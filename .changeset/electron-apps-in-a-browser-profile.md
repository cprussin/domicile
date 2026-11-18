---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/electron-host": minor
"domicile": minor
---

An Electron app can run in a browser profile, with that profile's extensions and sign-ins: `electron.profiles` in the config, or `domicile open --electron --profile <id>`. Links an app's page opens (`target="_blank"`, noopener) open in the desktop's browser, in the profile their site opens in, with the user's sign-ins, instead of in the app's own storage.
