---
"domicile": patch
"@domicile-desktop/electron-host": patch
---

`domicile open --electron` finds apps behind nixpkgs' compiled wrappers, as Claude's and ChatGPT's packages are, and runs them with what those wrappers set.

An app's first secret no longer crashes it when the login keyring is locked: the keyring asks to be unlocked, as with the app's own Electron, and a keyring that fails leaves the app without encryption, as Electron does.
