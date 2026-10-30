---
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-apps": patch
"@domicile-desktop/system-network": patch
---

`stat` reports `realPath`, the path with every link resolved, so two paths to one file compare equal. The file dialog uses it to list a user folder once when a link leads a second one to it.
