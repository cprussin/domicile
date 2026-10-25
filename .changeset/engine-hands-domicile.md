---
"@domicile-desktop/sdk": minor
"@domicile-desktop/engine": minor
"@domicile-desktop/component-library": patch
"@domicile-desktop/manganese": patch
"@domicile-desktop/manganese-bar-module-sharing": patch
"@domicile-desktop/shell-simple": patch
"@domicile-desktop/shell-splash": patch
"@domicile-desktop/app-history": patch
"@domicile-desktop/app-settings": patch
"@domicile-desktop/system-apps": patch
"@domicile-desktop/system-audio": patch
"@domicile-desktop/system-backlight": patch
"@domicile-desktop/system-network": patch
"@domicile-desktop/site": patch
---

The engine hands `Shell` the typed `Domicile` and an app's `main` the `AppDomicile`, built by the SDK's layer, which the engine bundles. Shells and apps no longer call `desktop()`/`appDesktop()`. The SDK drops `system()`, the portal watch helpers and `./appearance` from its public API; use the `Domicile` namespaces.
