# Electron apps

An installed Electron app runs on Domicile's engine instead of the Electron it
bundles. Its main process runs as an ordinary process with a stand-in
`electron` module, and its windows are app windows in the engine. The app
shares the desktop's browser, GPU and network processes, and its windows are
page elements like any other app window.

```
domicile open --electron claude-desktop
  ─▶ supervisor     {"type":"open_electron","app":"claude-desktop"}   control socket
       resolves the desktop entry ─▶ install ─▶ resources/app.asar
       spawns electron-host <app.asar>                                  bun, or node from the quirks table
  ─▶ electron-host  require("electron") = the stand-in
       runs package.json's main
       new BrowserWindow() ─▶ {"type":"create_window",…}                Electron socket
  ─▶ engine         an app window pinned to the app, its preload, its schemes
  ─▶ shell          DomicileBrowserWindow.isApp, plus its app menu
```

## Problem

- Every Electron app ships its own Chromium and runs its own browser, GPU,
  network and utility processes beside the desktop's.
- Its windows reach the desktop as Wayland surfaces, so they miss what page
  elements get: one layout, CSS, tabs.

## Design

### Running an app

- **`domicile open --electron <name|path>`** takes a desktop entry id or an
  install directory. An id is followed through the entry's `Exec` to the
  install, and the app is that install's `resources/app.asar`.
- **`electron.apps`** in the desk config lists desktop entry ids. The
  launcher starts those entries with `--electron` instead of their `Exec`.
  The app's own package installs and updates it; nothing is repackaged.
- **The supervisor spawns `electron-host`,** as it spawns any client, so the
  app outlives a shell reload.

### The main process: `electron-host`

A bun workspace package, `packages/electron-host`, run by Bun.

- Mirrors the install's `resources/` into
  `$XDG_CACHE_HOME/domicile/electron/<key>/`: every `*.asar` extracted to a
  directory of the same name, everything else a symlink. The key is the
  archives' paths, sizes and times, so an update makes a new mirror.
- Runs `package.json`'s `main` from the mirror.
- A module hook answers `require("electron")` with the stand-in, which
  implements Electron's main-process API over the Electron socket.
- Sets `process.type`, `process.versions.electron`, `process.resourcesPath`
  and `app.getPath()` as Electron does. `userData` is the app's existing
  directory (`~/.config/Claude`), so logins and settings carry over.
- Native modules load as they are. N-API is runtime-independent, and every
  native module in the apps inspected (below) is N-API.
- `utilityProcess.fork()` is a child process of the same runtime.
- **Quirks table:** per-app overrides inside the package, keyed by the
  app's `package.json` name: Node instead of Bun, an updater to skip, a known
  phase-2 app.

Bun over Node because the desktop already ships Bun for the builder. Node is
the fallback for an app Bun can't run, and becomes required in phase 2.

### The Electron socket

`--domicile-electron-socket <path>` makes the engine bind a Unix socket that
each `electron-host` keeps open for the app's life. The desktop passes it and
names it to apps in `DOMICILE_ELECTRON_SOCK`.

- Each line is one JSON object, both ways
  ([`electron_protocol.h`](../../packages/domicile-engine/src/components/domicile/browser/electron_protocol.h)).
  A binary body, for a protocol response, comes with the protocol handlers.
- One connection is one app. Closing it closes the app's windows.
- A request the engine needs answered (a protocol request, `sendSync`)
  carries an id; the host replies with that id.

### Windows

- **`new BrowserWindow()`** asks for an app window pinned to the app, as
  `open --app` does ([WEB-APPS.md](WEB-APPS.md)).
- **`WebContentsView`** and **`BrowserView`** are guests inside that window,
  placed at the bounds the app sets.
- **`loadURL`, `loadFile`, title, show, focus and close** map to existing
  window requests. Window size and position are ignored: the shell lays out
  windows.
- **`loadFile`** loads from the mirror, so the engine reads plain files.
- **Storage:** each app gets its own partition, named by its `package.json`
  name. Apps share no cookies with each other or with the browser.

### Preload and IPC

- **Preload:** the engine runs the window's preload in an isolated world
  before the page's own scripts, with `contextBridge` and `ipcRenderer` bound
  in, as in a sandboxed Electron page. The preload has no `require` beyond
  `electron`.
- **IPC** runs page ─▶ engine ─▶ Electron socket ─▶ host and back: `send`,
  `invoke`/`handle`, `postMessage` with ports, and `sendSync`. `sendSync`
  blocks only the calling page, on a sync Mojo call that the browser process
  answers when the host replies.

### Requests

- **`protocol.handle`** (and the older `register*Protocol`) registers the
  app's schemes (`app://`, `vscode-file://`) for its guests only. The engine
  forwards each request to the host and streams the response back. A
  response that is a file the engine can read is sent as its path.
- **`session.webRequest`**, cookies and `setPermissionRequestHandler` apply
  to the app's partition only.

### Desktop pieces

| Electron | Domicile |
|---|---|
| `Menu.setApplicationMenu`, `win.setMenu` | a menu bar under the window's tab, drawn by the shell |
| `Menu.popup` | a shell context menu |
| `Tray` | a StatusNotifierItem on D-Bus, as Electron does on Linux ([SYSTEM-TRAY.md](SYSTEM-TRAY.md)) |
| `Notification` | `org.freedesktop.Notifications`, as Electron does on Linux ([NOTIFICATIONS.md](NOTIFICATIONS.md)) |
| `dialog` | the file chooser portal ([PORTALS.md](/docs/PORTALS.md)) |
| `nativeTheme` | the desktop theme |
| `shell.openExternal` | `domicile open` |
| `safeStorage` | Secret Service on D-Bus |
| `desktopCapturer` | the share picker |
| `clipboard` | the desktop clipboard |
| `autoUpdater` | off; the app's package updates it |

App menus travel as a JSON model over the Electron socket. The engine puts
it on the app window, and the shell draws it as a menu bar under the window's
tab, with the menu component the tray uses. A click goes back as the item's
id. The bar behaves as on Electron for Linux: it follows the app's
`autoHideMenuBar` and `setMenuBarVisibility`, and Alt toggles it.

### Unsupported apps

An app whose pages need Node fails phase 1. When a window asks for
`nodeIntegration: true` or `sandbox: false` with a preload, `electron-host`
exits, the desktop shows a notification naming the app, and the supervisor
runs the entry's own `Exec`. Known ones go straight to `Exec` from the quirks
table.

### Phase 2: Node in the page

The engine embeds Node in the page processes of apps that ask for it, as
Electron does. Node, not Bun: pages run on V8, Bun on JavaScriptCore. The
main process moves to the same Node, so both sides load one build of each
native module.

## Apps inspected

Inspected 2026-11-13: every `.node` file's imports and every window's
`webPreferences`.

| App | Phase | Why |
|---|---|---|
| Claude Desktop 5.11492.2 | 1 | Sandboxed pages; N-API modules in main; `WebContentsView`, `utilityProcess`, `safeStorage` |
| VSCodium 1.143 | 1 | 13 N-API modules; sandboxed pages; heavy `sendSync` and custom schemes |
| Element 1.12.33 | 1 | Sandboxed; search index in main |
| Bitwarden 2026.10.2 | 1 | Sandboxed; N-API |
| Mattermost 6.3.2 | 1 | Sandboxed; N-API |
| FreeTube 0.26.0 | 1 | No native modules |
| Super Productivity 19.3.1 | 1 | No native modules |
| Signal 8.32.0 | 2 | Its page loads libsignal and ringrtc |
| Teams for Linux 2.29.0 | 2 | Preload uses Node, `contextIsolation: false` |
| Zulip 5.14.2 | 2 | `@electron/remote`, `<webview>`, `sandbox: false` |
| Joplin 3.7.22 | 2 | `nodeIntegration: true`, `@electron/remote` |

## Key decisions

- **Extract archives over reading them in place:** Bun's module loader reads
  the file system natively, so patching `fs` as Electron does can't make
  `require` see into an archive. A mirror also serves `loadFile` with no asar
  reader in the engine.
- **One generic host over per-app wrappers:** the quirks table holds what
  differs, so a new app needs no new package.
- **A socket over Mojo for the host:** Bun and Node can't speak Mojo; the
  engine translates at one boundary.
- **Fall back to the app's own Electron over refusing:** a user who lists an
  app still gets a working app.
- **Tray and notifications over D-Bus from the host:** the compositor already
  serves both, and Electron uses the same interfaces on Linux.

## Plan

- [ ] `electron-host`: resolve the app, mirror its resources, the `electron` hook, `app` lifecycle and paths
- [x] engine: the Electron socket and windows (`BrowserWindow` create, load, title, show, close)
- [ ] engine: preload, `contextBridge`, `ipcRenderer`, `invoke`, `sendSync`, message ports
- [ ] engine: `protocol.handle`, per-app partition, `session` and `webRequest`
- [ ] `WebContentsView`, `BrowserView`, `utilityProcess`
- [ ] tray, notifications, `dialog`, `nativeTheme`, `shell`, `safeStorage`, `desktopCapturer`, clipboard
- [ ] app menus: a menu bar under the window's tab; Alt toggles it
- [ ] `domicile open --electron`, `electron.apps`, the launcher hand-off, the fallback, the quirks table
- [ ] VM test with a fixture app, and memory against the same app on its own Electron
- [ ] phase 2: Node in the page
