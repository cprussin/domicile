# Electron apps

An installed Electron app runs on Domicile's engine instead of the Electron it
bundles. Its main process runs as an ordinary process with a stand-in
`electron` module, and its windows are app windows in the engine. The app
shares the desktop's browser, GPU and network processes, and its windows are
page elements like any other app window.

```
domicile open --electron claude-desktop.desktop [-- <its Exec>]
  ─▶ domicile       follows the entry's program, through wrapper scripts,
                    to the directory holding app.asar
       runs electron-host <resources> <the Exec's arguments>            bun
       exit 3: a page needs Node ─▶ a notification, then the Exec itself
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

- **`domicile open --electron <entry|path> [-- <command>…]`** takes a desktop
  entry id or a path into the install
  ([`electron_app.rs`](../../packages/domicile-launch/src/electron_app.rs)).
  The entry's program, or the command's when one is given, is followed
  through symlinks and through the paths each wrapper names until one is a
  directory holding `app.asar` or `app/`, or a program beside a `resources/`
  that does. Packages wrap Electron in scripts (`makeWrapper` on NixOS,
  shell scripts in `/usr/bin`), so the `Exec` rarely names it. On NixOS the
  wrapper is often compiled (`makeBinaryWrapper`, which wrapGAppsHook3 and
  wrapQtAppsHook use, as Claude's and ChatGPT's packages do); a compiled
  wrapper keeps the `makeCWrapper` command that made it, and the paths that
  command names are followed.
  What the wrappers set reaches the app: when the command is a bash script,
  it runs with `BASH_ENV` naming a script that replaces `exec`. Each script
  it execs runs the same way; the `exec` of the program execs `domicile`
  instead, which records the command line and the environment it got and
  exits. A compiled wrapper is followed by running its `makeCWrapper`
  command as bash, which sets what the wrapper sets, adds its flags and
  execs the same way. The app gets that
  environment (`LD_PRELOAD`, `PATH`) and those arguments, less the app's own
  path a generic Electron is given, as its `process.argv`
  ([`electron_wrapper.rs`](../../packages/domicile-launch/src/electron_wrapper.rs)).
  A command that is neither a bash script nor a compiled wrapper, or that never reaches the app's program
  within 10 seconds, gives its arguments alone, and the latter is logged.
- **`electron.apps`** in the desk config lists desktop entry ids. The
  compositor copies each entry into a directory first on the desk's
  `XDG_DATA_DIRS`, with every `Exec` running
  `domicile open --electron <id> -- <the original Exec>`, and without
  `DBusActivatable` and `TryExec`
  ([`electron_entries.rs`](../../packages/domicile-host/src/electron_entries.rs)).
  So whatever starts the entry by its id runs it on the engine: any shell's
  launcher, a `slack://` link through `domicile open` or GIO, a press on a
  notification. No shell needs to know. The copies are written at start and
  again when a reload changes the list. An entry in the data home
  (`~/.local/share/applications`) comes before every data directory, so it
  can't be overridden; that is logged as an error. The app's own package
  installs and updates it; nothing is repackaged.
- **`domicile` runs `electron-host`** (`libexec/domicile/electron-host`, or
  `DOMICILE_ELECTRON_HOST`) and waits on it, in the place of whatever started
  it: the compositor, for an app the launcher starts. So the app outlives a
  shell reload, as any client does.

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
- `utilityProcess.fork()` is a child process of the same runtime. Its module
  gets `process.parentPort`, and `MessageChannelMain` ports sent with a
  message carry structured clones over the child's IPC channel. Messages
  wait until the module has loaded, so one sent right after `fork` is not
  lost. The child lives until it exits or the app kills it, and goes with the
  host. Its `require("electron")` is not answered yet.
- **Quirks table:** per-app overrides inside the package, keyed by the
  app's `package.json` name
  ([`quirks.ts`](../../packages/electron-host/src/quirks.ts)). Today it names
  the apps that need their own Electron: the phase-2 apps inspected (below),
  and ChatGPT, which refuses to start on anything but OpenAI's Electron fork,
  Owl. Node instead of Bun and an updater to skip go there when an app needs
  them.

Bun over Node because the desktop already ships Bun for the builder. Node is
the fallback for an app Bun can't run, and becomes required in phase 2.

### The Electron socket

`--domicile-electron-socket <path>` makes the engine bind a Unix socket that
each `electron-host` keeps open for the app's life. The desktop passes it and
names it to apps in `DOMICILE_ELECTRON_SOCK`.

- Each line is one JSON object, both ways
  ([`electron_protocol.h`](../../packages/domicile-engine/src/components/domicile/browser/electron_protocol.h)).
  Protocol bodies travel as base64.
- One connection is one app. Closing it closes the app's windows.
- A request the engine needs answered (a protocol request, `sendSync`)
  carries an id; the host replies with that id.

### Windows

- **`new BrowserWindow()`** asks for an app window pinned to the app, as
  `open --app` does ([WEB-APPS.md](WEB-APPS.md)).
- **`WebContentsView`** and **`BrowserView`** are views: pages that are part
  of a window, not windows. Claude Desktop's whole chat is one, under its
  title bar page.
  - The host opens one with `open_window` and `"view": true`, and places a
    window's views with `set_views {window, views: [{window, x, y, width,
    height, hidden?}]}`, bottom first, replacing the ones it held. Only a
    window holds views, and only views are held. A view placed in another
    window moves there.
  - The engine lists a view to the shell only while a window holds it, right
    after that window, with `parent` and the app's bounds
    (`DomicileBrowserWindow.parent`, `x`, `y`, `width`, `height`,
    `isHidden`). It is never a capture source of its own.
  - **The shell lays views out.** The app's bounds are what it asks for:
    Manganese draws each view there, over its window, and another shell may
    put views in tabs or a split instead (user's decision, 2026-11-14).
  - The engine tells the app each page's size, its windows' and its views',
    with `resized {window, width, height}`, for `getContentBounds()`,
    `getBounds()` and the `resize` event.
  - A view outlives the window that held it until the app closes it, as an
    Electron app's do.
  - In the host, `win.contentView.addChildView(view, index?)`,
    `removeChildView`, `view.setBounds` and `view.setVisible` each send the
    window's `set_views`, only once the window and the view have opened and
    only when something moved. `BrowserView` is a view placed with
    `setBrowserView` and kin; its `setAutoResize` follows the window's
    `resized`. A view nested in a view throws, since only a window holds
    views. `BrowserWindow.fromWebContents` finds the window holding a view's
    page.
- **`loadURL`, `loadFile`, title, show, focus and close** map to existing
  window requests.
  - **Title:** a window has its own title, which the desktop shows (the
    shell's tab, capture tools) over its page's: `title` with `open_window`,
    then `set_title {window, title}` on `setTitle` and on each page title the
    app's `page-title-updated` listeners let through. An app that prevents
    them, as Claude Desktop does, keeps its own.
  - **Close:** the user closing a window doesn't close it. The engine says
    `close_asked {window}`, and the host emits the window's `close` event;
    only if no listener prevents it does the host ask with `close_window`.
    An app that closes to its tray, as Slack and Element do, prevents it and
    hides the window.
  - **Hide and show:** `hide()`, `show()`, `showInactive()` and `show:
    false` send `set_hidden {window, hidden}` (`hidden` with `open_window`).
    A hidden window stays open, its page running; the engine lists it with
    `isHidden`, which tells the shell to keep it out of sight, and leaves it
    out of capture tools' lists. `show()` also focuses it. Manganese takes a
    hidden window off its workspace and puts it on the one on screen when it
    is shown.
  - **Icon:** an Electron window is listed with its app's desktop id
    (`appId`), and Manganese draws the app's icon from its desktop entry for
    it, in its title bar and in the screenshot and screen cast pickers, over
    the page's icon. Window size and position are not the app's to set: the
  shell lays out windows. A window's size reads as the shell gave it
  (`getContentBounds`, `getBounds`, `getSize`), and `resize` fires as it
  changes; before the shell gives one, it is the size the app asked for.
- **`loadFile`** loads from the mirror, so the engine reads plain files.
- **Storage:** each app gets its own partition, named by its `package.json`
  name. Apps share no cookies with each other or with the browser.

### Preload and IPC

- **Preload:** the engine runs the window's preload in an isolated world
  before the page's own scripts, with `contextBridge` and `ipcRenderer` bound
  in, as in a sandboxed Electron page. The preload has no `require` beyond
  `electron`.
  The host sends the preload's source with `open_window`; the browser hands
  it to the window's main frame before each navigation commits, and the
  renderer runs it at document start, ahead of extensions' content scripts
  ([`electron_preload.h`](../../packages/domicile-engine/src/components/domicile/renderer/electron_preload.h)).
- **Node in the page:** a window that isn't sandboxed (`sandbox: false`, or
  `nodeIntegration` without `sandbox: true`, as Electron decides) has Node.js
  in its page instead. The host sends `node` with `open_window` in place of
  the preload's source: the preload's file, `nodeIntegration`,
  `contextIsolation`, the app's paths and environment. The browser learns
  which renderer the page's navigation goes to before it starts
  (`ContentBrowserClient::MainFrameNavigatesInto`, patch 0236) and starts it
  unsandboxed and outside the zygote, for that page alone, as Electron does
  ([`domicile_electron_page.h`](../../packages/domicile-engine/src/chrome/browser/domicile/domicile_electron_page.h)).
  There the renderer starts Electron's Node on its own V8, a Node environment
  in the preload's world (the page's own without context isolation), with
  libuv's loop run in turns off the renderer's, and loads the preload with
  Node's `require`, `require("electron")` giving the same `contextBridge` and
  `ipcRenderer`
  ([`electron_node.h`](../../packages/domicile-engine/src/components/domicile/renderer/electron_node.h)).
  With `nodeIntegration` and no context isolation the page gets `require`,
  `module`, `__filename` and `__dirname`; without either, Node's globals
  leave the page's world once the preload ran. A preload's `require` of a
  native module needs the engine to export Node's symbols, which it doesn't
  yet.
- **`contextBridge.exposeInMainWorld`** copies the API into the page:
  objects, arrays, dates, errors and bytes are copied, functions and promises
  are wrapped so they run and settle in their own world
  ([`context_bridge.h`](../../packages/domicile-engine/src/components/domicile/renderer/context_bridge.h)).
- **IPC** runs page ─▶ engine ─▶ Electron socket ─▶ host and back: `send`,
  `invoke`/`handle`, `postMessage` with ports, and `sendSync`. `sendSync`
  blocks only the calling page, on a sync Mojo call that the browser process
  answers when the host replies. Arguments travel as JSON, not structured
  clones, so a `Map` or bytes do not survive the trip.
- **Message ports:** each port the main process holds an end of is a relay.
  The preload's world keeps the page-side end of a pipe and forwards what
  arrives on it over the socket as `port_message`; the host's `port_post`
  goes the other way. A port's name says who made it (`m1` by the main
  process, `r1` by the page), and `page_gone` tells the host that a new
  document took the old one's ports.

### Requests

- **Sessions** are partitions inside the app's own: `session.fromPartition`
  and `webPreferences.partition` name one, `persist:` keeps it on disk as in
  Electron, and none reaches another app's storage or the profile's.
  `open_window` names the window's session.
- **`protocol.handle`** (and the older `register*Protocol`) sends a session's
  requests for a scheme to the app: `handle_protocol` names the session and
  scheme, the engine sends each request as `protocol_request`, and the app
  answers with a whole body, a file the engine reads, or a stream of pieces
  ([`electron_app.h`](../../packages/domicile-engine/src/components/domicile/browser/electron_app.h),
  [`domicile_electron_loader.h`](../../packages/domicile-engine/src/chrome/browser/domicile/domicile_electron_loader.h)).
  A window opens a URL in a scheme its session handles; content keeps other
  schemes out of guests.
- **`loadFile`** is a `file:` URL that the host's own `file:` handler serves,
  from the mirror, as Electron would serve it. The engine's file loader never
  serves an Electron page: what `file:` reads is the app's to decide.
- **`http` and `https`** go to the network unless the session handles them;
  the app then answers before anything else sees the request, as in Electron.
- **An app's own schemes** (`app://`, `cowork-artifact://`) are registered
  when the engine starts, because Chromium registers schemes only as each
  process starts. `ready` names the schemes the engine registered and the
  privileges it granted each. When an app's `registerSchemesAsPrivileged`
  names one the engine lacks, or a granted privilege it lacks, the host adds
  it to `$XDG_STATE_HOME/domicile/electron-schemes.json` (each app's package
  name, then its schemes and privileges) and exits 3, so the app runs on its
  own Electron this time
  ([`schemes.ts`](../../packages/electron-host/src/electron/schemes.ts)).
  At each engine start the supervisor passes every kept scheme as
  `--domicile-electron-schemes=app:standard,secure;…`, with Electron's names
  for the privileges, two apps' copies of a scheme getting what either asked
  for ([`electron_schemes.rs`](../../packages/domicile-launch/src/electron_schemes.rs)).
  The browser hands the switch to every child process. `standard`,
  `secure`, `bypassCSP`, `corsEnabled` and `supportFetchAPI` are granted;
  `stream`, `codeCache` and `allowServiceWorkers` are not yet, and don't
  hold an app back. A scheme the engine keeps for itself is refused without
  being kept ([`electron_schemes.h`](../../packages/domicile-engine/src/components/domicile/common/electron_schemes.h)).
  Local Network Access classes a page in one as loopback, as it does the
  shell: the app is installed on this machine, not a site. Left public, every
  request into the LAN or a VPN (Element's homeserver) asked a permission no
  one answers (patch 0238).
  An app's first run with a new scheme falls back. Known apps' schemes, as
  their own runs recorded them, register from the first start (`KNOWN` in
  `packages/domicile-launch/src/electron_schemes.rs`) to spare them that.
- **Not yet:** a handler's redirect (the load fails loudly), a request body
  that is a file or a stream, and requests from an Electron page's workers,
  which go to the network.
- **`session.webRequest`**: `web_request_listen` names the events a
  session has listeners for. Each of its pages' network requests then meets
  them in Electron's order. `onBeforeRequest` may cancel or redirect,
  `onBeforeSendHeaders` may replace the request's headers, and
  `onHeadersReceived` may cancel or replace the response's headers and
  status line; a document's CSP and Permissions-Policy follow the new
  headers. The request waits for each of those three
  (`web_request_answer`). `onSendHeaders`, `onResponseStarted`,
  `onBeforeRedirect`, `onCompleted` and `onErrorOccurred` only tell the app
  ([`domicile_electron_web_request.h`](../../packages/domicile-engine/src/chrome/browser/domicile/domicile_electron_web_request.h)).
  An answer that changes what its event cannot, or an app that goes while a
  request waits, cancels the request. Not yet: the headers the network
  service adds (cookies among them) are not in `requestHeaders`, a
  redirect `onHeadersReceived` writes is not followed, a redirect to a
  scheme the web cannot reach is refused, and WebSockets and workers' requests
  pass by the listeners.
- **Session calls** (`session_call`, answered by `session_result` under
  the same `call`): `cookies.get`, `set`, `remove` and `flushStore`,
  `clearStorageData`, `clearCache` and `setUserAgent`, each on one of the
  app's sessions and so on its partition only. `cookies.get` gives every
  cookie a request to its `url` could carry, HTTP-only and cross-site ones
  included, as Electron does. A session's user agent reaches its open
  windows from their next navigation and its new windows before their first
  ([`domicile_electron_storage.h`](../../packages/domicile-engine/src/chrome/browser/domicile/domicile_electron_storage.h)).
  Not yet: `cookies.on('changed')`.
- **User agent**: `ready` names the engine's user agent and Chrome's full
  version. The host makes Electron's from them (`Name/1.2.3 Chrome/<full>
  Electron/<version>` in Chrome's place) and sends it as
  `set_user_agent_fallback`, `app.userAgentFallback`, before the app's
  windows open. A session without its own user agent has it.
- **Permission handlers** (`permission_handler`): while one of the app's
  sessions has a `setPermissionRequestHandler`, its pages' permission
  requests ask the app (`permission_request`, answered by
  `permission_answer` under the same `ask`) instead of the shell, with
  Electron's names: `media` (its `mediaTypes`), `geolocation`,
  `notifications`, `clipboard-read`, `midiSysex`, `window-management`,
  `idle-detection`, and `unknown` for local fonts. Chrome keeps the answer
  for the origin as it keeps a user's, so the handler is asked when Chrome
  would prompt, not on every request as in Electron. A request Electron has
  no name for (several downloads at once) still asks the shell, as every
  request does in a session with no handler, where Electron would grant it.
  An app that goes while a request waits denies it
  ([`domicile_permissions.h`](../../packages/domicile-engine/src/chrome/browser/domicile/domicile_permissions.h)).
  Not yet: `setPermissionCheckHandler`, which Electron calls synchronously;
  checks answer from what Chrome kept.

### Desktop pieces

| Electron | Domicile |
|---|---|
| `Menu.setApplicationMenu`, `win.setMenu` | a menu bar under the window's tab, drawn by the shell. The host (`src/electron/browser-window.ts`) sends each window's menu model with `set_menu_bar` once the window opens and again whenever the menu changes, and runs the entry a `menu_clicked` names for that window. As on Electron for Linux, `setApplicationMenu` sets every window's menu and each new window starts with it; `autoHideMenuBar`, `setAutoHideMenuBar`, `setMenuBarVisibility` and `removeMenu` go along with it. Electron's default menu isn't made: an app with no menu has no bar |
| `Menu.popup` | a shell context menu |
| `Menu`, `MenuItem` | built in the host (`src/electron/menu.ts`): roles get Electron's Linux labels and accelerators, and role menus (`editMenu`, `viewMenu`, …) expand as Electron's do; macOS-only roles are hidden. The tray and the menu bar draw a menu's model and click its entries by number; a click toggles a checkbox or picks a radio first. A role the host doesn't carry out yet throws when clicked, naming it. `before`/`after` place items; group positions keep template order |
| `Tray` | a StatusNotifierItem on D-Bus, as Electron does on Linux ([SYSTEM-TRAY.md](SYSTEM-TRAY.md)), built in the host (`src/electron/tray.ts`). Each tray has its own bus connection, so `destroy` takes the icon down. The icon goes as `IconPixmap`, the tooltip as `ToolTip`'s title, and the context menu as a `com.canonical.dbusmenu` at `/MenuBar` that the shell draws and clicks; a change anywhere in the menu sends `LayoutUpdated`. `Activate` is `click`, `SecondaryActivate` `middle-click` and `ContextMenu` `right-click`. The click's activation token isn't needed: the engine raises the app's windows itself. Balloons, pressed images, `setTitle` and `getBounds` are other platforms' and do nothing |
| `Notification` | `org.freedesktop.Notifications`, as Electron does on Linux ([NOTIFICATIONS.md](NOTIFICATIONS.md)): a click is the `default` action, buttons are actions numbered from 0, `hasReply` is `inline-reply`, and `desktop-entry` names the app. An icon is a file path; a `nativeImage` icon throws until the host has `nativeImage` |
| `dialog` | file dialogs through the file chooser portal ([PORTALS.md](/docs/PORTALS.md)), built in the host (`src/electron/dialog.ts`): Electron's properties, filters, button label and default path become the portal's options, and its URIs come back as paths. The `Sync` calls block on a child process that asks the portal (`src/choose-file.ts`), as Electron's block the main process. Dialogs aren't tied to the app's window yet: Electron windows are the shell's pages, not toplevels a portal can name. `showMessageBox` sends `show_message_box` over the window the app names, or its most recent open one, and resolves with the `message_box_answered` the shell's answer brings (`src/electron/message-boxes.ts`); with no window open it rejects. As Electron, no buttons is one OK, and the cancel button the app names none for is the first labeled Cancel or No. `showMessageBoxSync` throws, as nothing can block for the shell's answer; `showErrorBox` writes to the host's log |
| `nativeTheme` | the settings portal's `org.freedesktop.appearance` `color-scheme` and `contrast`, read before the app's main runs and followed after; the app's `themeSource` overrides `shouldUseDarkColors` |
| `shell.openExternal`, `openPath`, `showItemInFolder` | `domicile open` (the item's folder for `showItemInFolder`) |
| `safeStorage` | Chromium's OSCrypt for Linux, byte for byte, built in the host (`src/electron/safe-storage.ts`), so what an app encrypted on its own Electron decrypts here and back: AES-128-CBC with the PBKDF2 key of a password the Secret Service keeps as "Chromium Safe Storage" with `application` set to the app's name (`src/secret-service.ts`), prefixed `v11`. The password is read, or created, when the app first needs it, blocking on a child process (`src/safe-storage-password.ts`) as Electron blocks on libsecret, so a locked keyring asks to be unlocked then, both to read the password and to create it. The backend is chosen as Chromium chooses it, so an app finds its store where its own Electron left it: `--password-store` first (`basic` is `basic_text`; `gnome`, `gnome-keyring` and `gnome-libsecret` are the Secret Service; KWallet hands the app back), then `XDG_CURRENT_DESKTOP` (GNOME, Cinnamon, Pantheon, XFCE, Unity, Deepin and UKUI use the Secret Service; KDE hands the app back; any other desktop, Domicile included, is `basic_text`, as on Chromium). On `basic_text` the keyring is never read. With no Secret Service, an unlock refused, or a Secret Service that fails (said on stderr), the backend is `basic_text` too: encryption needs `setUsePlainTextEncryption(true)` and uses the hardcoded `v10` key, as in Electron |
| `desktopCapturer`, `setDisplayMediaRequestHandler` | the desktop's share picker, as Electron's own under Wayland. `desktopCapturer.getSources` gives one source, "Screen or window" (`screen:0:0`, or `window:0:0` when only windows are asked for), with an empty thumbnail; a page's `getUserMedia()` with it as `chromeMediaSourceId` opens the picker, which says what is captured, sound included when asked. `getDisplayMedia()` opens the same picker, as Electron's `useSystemPicker` does, so a display media handler is kept but not asked (`src/electron/desktop-capturer.ts`) |
| `clipboard` | the desktop clipboard through `wl-paste` and `wl-copy`, which the compositor serves with data-control (docs/use/CLIPBOARD.md), built in the host (`src/electron/clipboard.ts`). Each call waits on its command, as Electron's clipboard is synchronous; `selection` is the primary selection. `wl-copy` offers one type per copy, so a `write` of several formats throws, naming them, until the host can offer several. Rich copies in pages go through the engine's own clipboard, which has no such limit. The host's package needs `wl-clipboard` on its `PATH` |
| `nativeImage` | the image's PNG or JPEG bytes, in the host. PNGs are read and written without a library (`src/png.ts`) for `resize`, `crop` and bitmaps; a JPEG is kept as it came and can't be decoded, so those throw for one. One scale factor, 1 |
| `autoUpdater` | off; the app's package updates it |

App menus travel as a JSON model over the Electron socket:
`set_menu_bar {window, menu: [entries] | null, visible, auto_hide}`. The
engine checks the entries, keeps only the keys the shell reads, and lists the
menu with the window (`DomicileBrowserWindow.menu`, `menuBarVisible`,
`menuBarAutoHide`). The shell draws it as a menu bar under the window's tab,
with the menu component the tray uses. A click goes back through
`clickBrowserWindowMenu` to the app as `menu_clicked {window, command}`, the
entry's id. The bar behaves as on Electron for Linux: it follows the app's
`autoHideMenuBar` and `setMenuBarVisibility`, and Alt toggles it. Only a
window has a menu bar; a view's is refused.

Message boxes travel the same way: `show_message_box {window, box, box_type,
title, message, detail, buttons, default_id, cancel_id, checkbox_label,
checkbox_checked}`, with 1 to 16 buttons. The engine checks the box and lists
it with the window (`DomicileBrowserWindow.messageBox`), one box at a time: a
window that asks another while one shows lists it once the first is answered.
The shell draws it over the window's page and answers through
`answerBrowserWindowMessageBox`, which reaches the app as
`message_box_answered {window, box, response, checkbox_checked}`. A window
that closes under its boxes answers each with its `cancel_id`, as the app
waits on every one. Only a window shows a message box; a view's is refused.

### Unsupported apps

An app the engine can't run yet falls back to its own Electron. When a
sandboxed window asks for `contextIsolation: false`, whose preload would run
in the page's own world without Node, `electron-host` exits with status 3,
whatever the app catches; a window with Node in its page runs on the engine
(see [Preload and IPC](#preload-and-ipc)). `domicile open --electron` then
shows a notification naming the app and runs its own command: the one given
after `--`, else the entry's `Exec`. An app named by its path alone has no
command to fall back to, and the status is passed on. An app the quirks
table names as needing its own Electron exits with status 3 before its main
runs, so its own Electron starts without a window opening on the engine
first.

### Every API

An app must never find a plain `undefined` where Electron has an API: that
is a `TypeError` in the app's main, which takes the app down with no reason
given and no fallback. `scripts/electron-surface.ts` reads `electron.d.ts`
from Electron 45.2.1 and the newest release of each of the twelve majors
before it, and writes `src/electron/surface.ts`: every module, its methods
and properties, which exist only on macOS or Windows, and each instance
class's members with its parents'. Regenerate it with
`bun scripts/electron-surface.ts` when Electron ships a major.

At start the host fills what it lacks from the surface
(`src/electron/complete.ts`):

- A Linux method the host doesn't have exits with status 3, naming it, so the
  app runs on its own Electron, as for [unsupported apps](#unsupported-apps).
- A macOS or Windows method does nothing and gives `undefined`, as
  Electron's does on Linux.
- A property the host doesn't have logs once and reads as `undefined`; an
  object may still set it.
- A name Electron itself doesn't have logs once ("doesn't have on Linux"):
  the surface is stale or the app is probing.

`src/__integration__/coverage.json` lists every gap left: each name an app
would be handed back for ("missing"), find `undefined` for ("absent"), or
that the test can't make an object to measure ("unmeasured").
`coverage.test.ts` measures them on the running host and fails when the
list is off either way, so a gap a new Electron opens, or one a change
closes, is seen. Update it with `UPDATE_COVERAGE=1 bun test coverage`.

What the host has is real where the engine can do it and a stated answer
where the shell owns it: window state reads as shown and normal, because
the shell lays windows out, and `globalShortcut` refuses with a warning,
because shortcuts are the shell's. `screen` and `powerMonitor` follow the
desk through `domicile subscribe` from their first use. The
`electron-apps-start-on-a-tty` VM test starts Element and Slack as packaged
and fails on a crash or on Element leaving the engine.

### Phase 2: Node in the page

The engine embeds Node in the page processes of apps that ask for it, as
Electron does. Node, not Bun: pages run on V8, Bun on JavaScriptCore. The
main process moves to the same Node, so both sides load one build of each
native module.

Electron's `main` is on Chromium 160.0.8158.0, three builds from the
engine's 160.0.8155.0, with Node v26.13.1. So the engine takes Electron's
Node as Electron builds it, rather than porting a Node to this V8:

1. **Node in the engine.** Electron's Node fork at the commit its `DEPS`
   names, with its `patches/node`, built by Node's own GN files against the
   engine's V8 and BoringSSL, linked into the engine. The engine binary runs
   as plain Node when told to, as `ELECTRON_RUN_AS_NODE` does.
2. **Node in a page.** A window whose `webPreferences` ask for it
   (`nodeIntegration`, `contextIsolation: false` with a Node preload,
   `sandbox: false`) gets an unsandboxed page process with a Node
   environment in its main world, and libuv run off the renderer's own
   loop, as Electron's `NodeBindings` does. Every other page stays
   sandboxed and Node-free. `require("electron")` in the page is the
   existing preload surface.
3. **The main process on that Node.** `electron-host` runs on the engine's
   Node instead of Bun, with `electron` resolved through Node's module hooks,
   so a native module loads once for both sides.
4. **`<webview>` in Electron pages**, as Zulip uses it, over the guests the
   engine already has.
5. **App by app:** Joplin, Teams for Linux, Zulip and Signal, each leaving
   the quirks table as it runs.

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
| ChatGPT 26.1103.60933 | none | Needs Owl, OpenAI's Electron fork: throws at start without `app.showTaskManager`, then calls Owl's own APIs |

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
- **`dbus-next` for the host's D-Bus:** a pure-JS client that runs under
  Bun. Its optional native socket modules stay unbuilt; the host needs none
  of what they add (fd passing, abstract sockets).

## Plan

- [x] `electron-host`: resolve the app, mirror its resources, the `electron` hook, `app` lifecycle and paths
- [x] engine: the Electron socket and windows (`BrowserWindow` create, load, title, show, close)
- [x] `electron-host`: `BrowserWindow` over the Electron socket
- [x] engine: preload, `contextBridge`, `ipcRenderer` `send`/`on`/`invoke`, `webContents.send`
- [x] `electron-host`: `webPreferences.preload`, `ipcMain`, `webContents.send`
- [x] engine: `sendSync`, message ports
- [x] `electron-host`: `sendSync`, `postMessage`, `MessageChannelMain`
- [x] engine: `protocol.handle`, `loadFile` and sessions
- [x] engine: an app's own schemes, registered at start
- [x] engine: `webRequest`
- [x] engine: cookies, storage clearing, `clearCache`, `setUserAgent`
- [x] engine: permission handlers
- [x] `electron-host`: `protocol.handle`, `loadFile`, `session.fromPartition`
- [x] `electron-host`: `session.webRequest`
- [x] `electron-host`: session cookies, storage clearing, `clearCache`, `setUserAgent`
- [x] `electron-host`: `setPermissionRequestHandler`
- [x] `electron-host`: `utilityProcess`
- [x] engine: views (`set_views`), listed to the shell under their window, and each page's size
- [x] shells: the SDK lists views apart (`browser.views`); Manganese draws them where their apps ask
- [x] `electron-host`: `WebContentsView`, `BrowserView`, `contentView`, `getContentBounds` and `resize`
- [x] `electron-host`: `shell` (`openExternal`, `openPath`, `showItemInFolder`) and `nativeTheme`
- [ ] engine: an app's `nativeTheme.themeSource` reaches its pages' `prefers-color-scheme`
- [x] `electron-host`: `Notification`
- [x] `electron-host`: `nativeImage`
- [x] `electron-host`: `Menu` and `MenuItem` (the model the tray and menu bar draw)
- [x] `electron-host`: `Tray`
- [x] `electron-host`: `dialog` file dialogs
- [x] `electron-host`: `safeStorage`
- [x] `electron-host`: `clipboard`
- [ ] `clipboard.write` of several formats at once
- [x] `desktopCapturer` and `setDisplayMediaRequestHandler`, through the desktop's share picker; engine: a desktop `getUserMedia()` opens it
- [x] engine: app menus (`set_menu_bar`), listed with the window, and clicks back to the app (`menu_clicked`)
- [x] Manganese: app menus as a menu bar under the window's tab; accelerators run their entries; Alt toggles an auto-hidden bar, and Alt with a mnemonic opens a menu
- [x] `electron-host`: `setApplicationMenu`, `setMenu` and the menu bar's settings reach the engine; clicks come back
- [x] engine: message boxes (`show_message_box`), listed with the window one at a time, and answers back to the app (`message_box_answered`)
- [x] Manganese: message boxes over the window's page, the app's buttons in its order; Enter presses its default and Escape its cancel
- [x] `electron-host`: `dialog.showMessageBox`
- [x] `domicile open --electron`: the app from its entry or path, and the fallback to its own Electron
- [x] `electron.apps`: every start of a listed entry goes through `domicile open --electron`
- [x] an app's own schemes kept for the next engine start
- [x] the quirks table: known phase-2 apps go straight to their own Electron
- [x] known apps' schemes (Element, Claude, Slack, ChatGPT, from their own runs) register from the first engine start (`KNOWN` in `packages/domicile-launch/src/electron_schemes.rs`)
- [x] VM test with a fixture app, and memory against the same app on its own Electron (`electron-app-on-a-tty` in `flake.nix`)
- [x] every Electron API an app can call: what the host lacks hands the app back with a reason, never a `TypeError` (`electron-apps-start-on-a-tty` in `flake.nix`)
- [x] engine: a window's own title (`set_title`), hidden windows (`set_hidden`), and the user's close asking the app (`close_asked`); `ipcRenderer` is an EventEmitter (`emit` reaches the preload's own listeners, which Element's preload relies on)
- [x] `electron-host`: `setTitle`, `hide`, `show`, `showInactive`, `show: false`, and the `close` event for the user's close
- [x] Manganese: hidden Electron windows off every workspace; app windows drawn with their app's icon
- [x] engine: `webContents.executeJavaScript` and `mainFrame` (a `WebFrameMain` for the page's one frame), which Claude calls at start: the code runs in the page's main world after any load under way, a promise it gives is awaited, and what it gives comes back as JSON carries it (`execute_javascript` and `javascript_result` in `electron_protocol.h`). A throw rejects with a generic reason; the page's console has the exception
- [ ] engine: a message box before any window has a page, which Element shows when there's no keyring and hands itself back on
- [ ] phase 2, engine: Electron's Node built into the engine, and the engine run as Node
- [x] phase 2, engine: Node in the pages of windows that ask for it (`guard-electron-node.sh`)
- [ ] phase 2, engine: native modules in pages (Node's symbols exported from the engine)
- [ ] phase 2, `electron-host`: the main process on the engine's Node
- [ ] phase 2, engine: `<webview>` in Electron pages
- [ ] phase 2: Joplin, Teams for Linux, Zulip and Signal on the engine, out of the quirks table
