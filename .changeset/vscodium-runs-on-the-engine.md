---
"@domicile-desktop/electron-host": patch
"domicile": patch
---

VSCodium runs on the engine. Electron apps' mains get `original-fs` and `module.registerHooks` (resolve hooks for `require`), and VSCodium's schemes register from the engine's first start. `domicile open --electron` follows wrappers into an app's own `sh` launcher, says when one exits without starting a program, and kills whatever following them started.
