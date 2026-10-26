---
"@domicile-desktop/system-backlight": minor
"@domicile-desktop/manganese-bar-module-brightness": major
"@domicile-desktop/manganese": patch
---

Automatic brightness and the shared backlight move into `@domicile-desktop/system-backlight`: `./auto-brightness`, `./shared-backlight`, `./host-backlight` and `./host-ambient-light` (no React), and `./react` with `useBacklightLevel`, `useHasBacklight`, `useAutoBrightness` and `deskBacklight`. The brightness bar module no longer exports `./desk-backlight`, `./useAutoBrightness` or `./fixture` (now `system-backlight/fixture`).
