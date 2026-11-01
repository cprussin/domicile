# @domicile-desktop/test-support

## 0.0.2

### Patch Changes

- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- d80e2f5: Popups stay inside their window. `PopupBoundary` keeps every tooltip, popover, menu and list inside it within its box; `Popover` and `Tooltip` take `spansWindows` to leave it. Each window and tab keeps its popups inside its frame, so a tab's tooltip no longer covers the windows beside it. `test-support/popup-layout` fakes the layout a popup is placed by.

## 0.0.1

### Patch Changes

- c705ff5: `loadEmittedStylesheet` removes its stylesheet once the enclosing file or `describe` has run. Test files share one document, so stylesheets left behind slowed every later file's style lookups until `BrowserWindow`'s context-menu tests timed out in CI. `BrowserWindow`'s tests load it only where they read a style.
