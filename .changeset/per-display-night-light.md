---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
---

Night-light apps such as gammastep and wl-gammarelay-rs work: Domicile speaks `wlr-gamma-control`, so each can warm, dim or curve each monitor on its own. While an app holds a monitor, the shell's night light leaves it alone, and takes it back when the app lets go. `displays.setColorTemperature(kelvin, display)` warms one monitor by name.
