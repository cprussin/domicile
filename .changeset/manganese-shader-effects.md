---
"@domicile-desktop/manganese-window-management": minor
"@domicile-desktop/manganese": minor
---

Shader effects in manganese: workspace switches blur windows along their slide, the overview throws the wallpaper out of focus, glass dialogs such as the launcher are frosted, and the theme wipe comes in behind a soft edge. They are on by default, off under reduced motion, and switched with `shell_options.effects.windows`. Each effect takes `--device-pixel-ratio`, which the shell sets on `<html>`, so it measures in CSS pixels. Add `WINDOW_EFFECTS` and the `_slideBlur` and `_depthOfField` conditions.
