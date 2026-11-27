---
"@domicile-desktop/engine": patch
"@domicile-desktop/e2e-harness": patch
"domicile": patch
---

A keybinding fires from every key that types its keysym, not only the lowest one, so `XF86AudioPlay` also answers a headset's play button, such as AirPods'. `shell_config`'s `keys` maps each keysym to every key it is on, lowest first.
