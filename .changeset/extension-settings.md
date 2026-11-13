---
"@domicile-desktop/engine": minor
"domicile": minor
"@domicile-desktop/sdk": minor
"@domicile-desktop/app-settings": minor
"@domicile-desktop/e2e-harness": patch
---

Extensions can run in private windows. Each extension's chrome://extensions settings are now yours to set: whether it runs in private windows and on local files, whether it may run user scripts, and which sites it runs on (when you click it, on specific sites, or on all sites). Set them in the config's `extensions.settings`, by extension id, or in the Settings app, which shows the ones an extension can use while it is on and moves Options and Uninstall to the bottom of its row. A setting the config drops goes back to Chrome's default.
