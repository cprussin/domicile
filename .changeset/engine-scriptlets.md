---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"domicile": minor
---

The engine runs the scriptlets filter lists name with `##+js(...)`, in the page's own world before any of its scripts, from the config's new `browser.scriptlet_resources`: uBlock Origin's scriptlets unless set, built and published by CI and pinned by their sha256, and `null` runs none.
