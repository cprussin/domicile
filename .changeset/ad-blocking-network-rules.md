---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"domicile": minor
---

The engine acts on the lists' `$redirect`, `$removeparam` and `$csp` rules, blocks a server's redirect to a blocked address, finds a tracker behind a CNAME by its canonical name, as Brave does, and keeps each list as long as its `! Expires:` says. The config's new `browser.block_in_electron_apps` blocks in Electron apps' pages too, in Standard. Carried from #2662 by lillecarl.
