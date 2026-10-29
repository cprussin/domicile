---
"@domicile-desktop/engine": minor
"@domicile-desktop/sdk": minor
"domicile": minor
---

App windows can belong to an app id, and a launch can reuse that app's open window instead of opening another: `domicile open --app --id <id> --reuse focus|navigate <url>`, or `browser.openApp(url, { id, reuse })`. Windows list their `appId`. `browser.countMatches(id, selector)` counts elements in a browser window's page, hidden or not.
