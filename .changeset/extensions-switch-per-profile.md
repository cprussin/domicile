---
"@domicile-desktop/sdk": major
"@domicile-desktop/engine": major
"@domicile-desktop/app-settings": minor
"@domicile-desktop/manganese-bar-module-tray": minor
"domicile": minor
---

Extensions are switched on per profile. The Settings app's Extensions page has no switch: it shows the profiles each extension is on in, with **Choose profiles**, shows its settings while it is off, and asks which profiles a folder just loaded goes on in. The tray's menu switches an extension the config lists by a temporary change of the profile's list, until the desktop restarts. The Profiles page does the same on a read-only config, and on one it writes changes the file's list in one click; either way it shows "Changed from your config" with Reset. The SDK drops `extensions.setEnabled`; `browser.setExtensionEnabled` switches through the config where the config sets it, and `browser.changedExtensions` and `browser.resetExtension` show and end those changes.
