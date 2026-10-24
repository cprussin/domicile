---
"@domicile-desktop/manganese-bar-module-google-messages": patch
"@domicile-desktop/sdk": minor
---

The Google Messages item counts unread conversations read from the page, including ones that were unread before the desktop started, rather than counting its notifications. `<webview>` gains `countMatches(selector)`, which counts the elements in its page that match a CSS selector.
