# @domicile-desktop/test-support

## 0.0.2

### Patch Changes

- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.

## 0.0.1

### Patch Changes

- c705ff5: `loadEmittedStylesheet` removes its stylesheet once the enclosing file or `describe` has run. Test files share one document, so stylesheets left behind slowed every later file's style lookups until `BrowserWindow`'s context-menu tests timed out in CI. `BrowserWindow`'s tests load it only where they read a style.
