---
"@domicile-desktop/react": patch
"@domicile-desktop/manganese-host": patch
"@domicile-desktop/shell-simple": patch
---

`@domicile-desktop/react/elements` types the engine's `<app>` and `<webview>` in JSX, so a React shell writes `<app app-id={…} />` without declaring it.
