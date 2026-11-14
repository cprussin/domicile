# @domicile-desktop/electron-host

## 0.1.0

### Minor Changes

- 7bef546: `electron-host` connects to the engine's Electron socket (`DOMICILE_ELECTRON_SOCK`) as the app, named by its `desktopName`, and its `BrowserWindow` opens, loads, focuses and closes app windows there. A window takes its page's title, is ready to show once its page loads, and the app quits with its last window unless it listens for `window-all-closed`.
- 6fb921e: Add `electron-host`: runs an installed Electron app's main process with a stand-in `electron` module (`app` identity, paths and lifecycle), from a mirror of its resources with every asar extracted.
