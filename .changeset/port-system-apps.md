---
"@domicile-desktop/sdk": minor
"@domicile-desktop/system-apps": minor
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-host": patch
"@domicile-desktop/manganese-launcher": patch
"@domicile-desktop/manganese-window-management": patch
"@domicile-desktop/manganese-bar-module-tray": patch
"@domicile-desktop/manganese-bar-module-sharing": patch
"@domicile-desktop/manganese-bar-module-idle-inhibitor": patch
"@domicile-desktop/manganese-lock": patch
"@domicile-desktop/manganese": patch
"@domicile-desktop/shell-splash": patch
"@domicile-desktop/app-history": patch
"@domicile-desktop/app-settings": patch
"@domicile-desktop/manganese-bar-module-keymap": patch
---

Everything that took `system(domicile)` takes `desktop(domicile)`, or the namespace it calls.

- SDK: `keyboard.keymaps` and `keyboard.selectKeymap`. `watchMenu`, `readIconTheme`, `watchIconTheme` and `previewFile` take `{ dbus }` or `{ files }`. `MenuSystem`, `IconThemeSystem` and `PreviewSystem` are `MenuDesktop`, `IconThemeDesktop` and `PreviewDesktop`.
- system-apps: functions take `AppsDesktop` (`./apps-desktop`). `./fake-system`'s `fakeSystem` is `./fake-desktop`'s `fakeDesktop`.
- component-library: `AppChooser`'s `system` prop is `domicile`; `PortalDialogs`' `systemOf` is `desktopOf`, and its `host` is a whole `DomicileHost`; `systemFolders` is `desktopFolders`, over `domicile.files`; `usePictureUrl` and `useApps` take `domicile.files` and `AppsDesktop`.
