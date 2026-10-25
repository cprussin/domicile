---
"domicile": minor
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/manganese-launcher": patch
"@domicile-desktop/site": patch
"@domicile-desktop/app-history": patch
"@domicile-desktop/app-settings": patch
"@domicile-desktop/e2e-harness": patch
---

`domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
