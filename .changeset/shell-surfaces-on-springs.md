---
"@domicile-desktop/component-library": minor
"@domicile-desktop/manganese-launcher": minor
"@domicile-desktop/manganese-bar-module-launcher-button": patch
"@domicile-desktop/manganese-bar-module-workspace-switcher": patch
"@domicile-desktop/manganese-lock": patch
"@domicile-desktop/manganese-page-requests": patch
"@domicile-desktop/manganese": patch
---

Move the shell's surfaces onto the `springs.*` tokens:

- `Popover` grows from its trigger, and `ModalDialog` takes an `origin` (or a `DialogOrigin` around it) to spring from and back into. Portal dialogs and the file picker spring from the window that asked, and the launcher from the bar button that opened it.
- `SlideOver`, `Toaster` and `LevelToast` move on springs; a swiped toast leaves at the speed it was let go.
- What is in a `ListRow` drawer fades and slides into place on springs.
- Menus, `Select` lists and tooltips fade in rising 2px off their anchor.
- The region picker's corners snap out on a spring when let go, and the recording toolbar springs in.
- The lock's clock and field, page dialogs and the workspace switcher's highlight move on springs.
