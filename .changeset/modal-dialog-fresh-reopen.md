---
"@domicile-desktop/component-library": patch
---

`ModalDialog` starts its content fresh when reopened before its close animation ends, so the launcher and clipboard history no longer keep the last query.
