---
"domicile": minor
"@domicile-desktop/engine": minor
---

Chrome never draws a dialog over the desktop. Any Chrome dialog the shell has no answer for is canceled and logged, so a gap fails closed. Payment Request and FedCM ("Sign in with Google"'s account chooser) are off, so sites use their own checkout and sign-in pages, and picture-in-picture video is off since Chrome floats it in a window of its own. Document picture-in-picture still opens, as a shell window.
