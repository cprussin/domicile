---
"domicile": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/e2e-harness": patch
"@domicile-desktop/manganese-window-management": minor
---

`domicile completions` asks the shell for placeholders only it knows: `bindKeys` takes `onComplete(args)`, which returns the words that can follow. Manganese completes its workspace names after `workspace` and `move container to workspace`.
