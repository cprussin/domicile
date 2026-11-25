# domicile

## 1.3.1

### Patch Changes

- 701bd16: The engine always starts the shell in the `Default` browser profile, never in the profile Chromium saved as last used.

## 1.3.0

### Minor Changes

- 7680c50: Extensions work in every browser profile. An extension the user installs from the Web Store or loads unpacked in one profile is installed in every other, starting on (off in a private profile) and switchable in each, and one they uninstall leaves them all. The tray shows the actions of the focused page's profile's extensions and opens their popups in that profile, so an extension switched on only in another profile, such as 1Password in a work profile, has its icon, popup and sign-in there. The SDK adds `extensions.setProfile`, and each action and popup request carries its `profile`.
- 9478a19: Each browser profile in the config is a Chrome profile of its own, with its own sign-ins, site data and extensions; a private profile keeps nothing past its last page. Shells get `domicile.browserProfiles`, each browser window's `profile`, `openBrowserWindow(url, partition, profile)` and `<webview profile>`. Private pages now open in the default private profile. Extensions stay out of it unless its `extensions` names them, rather than through `extensions.settings.<id>.private`.
- 87ac040: The compositor serves `xdg-system-bell-v1`, so a terminal's bell reaches the shell. `domicile.windows.bells()` streams each ring with the `appId` of the window that rang.
- 394ecc7: Electron apps can pop up menus (`Menu.popup`), as Claude's menu button does: the shell draws the app's menu where the button was pressed, with the same look as the app's menu bar, and the entry chosen runs in the app. Shells read a window's popup menu from `popupMenu` (`appPopupMenu` in `@domicile-desktop/sdk/app-menu`) and answer it with `domicile.browser.answerPopupMenu`.
- 2794947: Electron apps can make their windows fullscreen (`setFullScreen`), and they read and hear what the shell makes them (`isMaximized`, `isFullScreen`, `maximize`, `enter-full-screen` and the rest) instead of a window that always reads as normal. Shells read what an app asks from a window's `wantsMaximized`, `wantsMinimized` and `wantsFullscreen`, and report what they made it with `domicile.browser.setWindowState`.
- 0e71fa1: Games and VM viewers can confine the pointer to their window, or the part of it they name, and read raw mouse motion. On a console the engine holds its cursor inside the boxes the shell passes to the new `DomicileHost.confinePointer` (`pointer.confine` in the SDK), across monitors too; `DomicileWindow.pointerRegion` is the client's region. Relative motion now carries the mouse's unaccelerated deltas from libinput as `dx_unaccel`/`dy_unaccel`, so aiming no longer follows pointer acceleration, and a shell's warp still sends no motion. Manganese confines the pointer for the focused window that asks, and follows it as it moves.
- d173ce0: A monitor whose EDID reports 10 bits a channel now scans out in 10 bits where the GPU's planes take a 10-bit format, and its link is asked for 10 bits (`max bpc`), so gradients no longer band. Monitors through a DisplayLink dock stay 8-bit.
- 0bc17bc: Electron apps on the engine get `webContents.debugger` on a DevTools client of their own, and `takeHeapSnapshot`, `savePage` as MHTML, `insertText`, `stop`, `scrollToTop`, `scrollToBottom`, `getPrintersAsync`, `setImageAnimationPolicy`, `setWebRTCUDPPortRange`, `forcefullyCrashRenderer`, `saveVideoFrameAs` and `webFrameMain.collectJavaScriptCallStack`. A window that asks to be drawn offscreen is unsupported, so the app runs on its own Electron.
- f5fbd04: The desk config's `electron.apps` lists desktop file ids of installed Electron apps to run on the desktop's engine. The compositor writes a copy of each entry that runs it with `domicile open --electron`, first on the desk's data directories, so the launcher, links such as `slack://` and notification presses all start it on the engine, whatever the shell.
- 4acd3cd: `domicile open --profile <id> <url>` opens a link in that browser profile, and a link opened without one goes to its site's profile instead of always the default one. The SDK's `browser` gains `profiles`, a `profilesChange` event, `profileFor(url)`, `reopen(id, profile)` and a `profile` option on `open`.
- d0fbc5b: Turn your monitors off on demand with `domicile sleep-displays`, and back on with any key, click or pointer move, or `domicile wake-displays`. Your windows and workspaces stay where they were. Shells get the same through `displays.sleep()` and `displays.wake()`.
- b09fd4b: A window's subsurfaces are drawn inside the window itself, as other compositors draw them. Firefox and Tor Browser windows, which draw everything into a subsurface, now move, scale and fade with their window on workspace switches and other animations, and sit under the shell's overlays. Chromium's extension popups do too. Pointer and touch reach the subsurface under them.
- 23cbfe3: Add `domicile list-inputs [--json]`, which prints each keyboard, pointer and touch device the desktop reads: its kind, how it is attached, its USB or Bluetooth ids and its name. The engine reports the devices through a new `input_devices` callback.
- e4706b9: `domicile status` prints the shell, theme, keymap, lock, whether the screens
  are off, what keeps them on and what records or controls the desktop. `--json`
  for scripts.
- 6f3ec06: Settings has a Profiles page: a card per browser profile with its color, whether it is private and its extension switches, and one list of the sites that open outside the default profile. Profiles, colors, Private and the default change in the config; extension switches and sites added here are saved by the desktop, under the config's. Adding a site that is already listed points at its row. The engine's command socket answers `browser_profiles` and `pin_browser_site`, and `set_extension_enabled` takes a `profile`.
- 10b47c9: `domicile devtools` sends a DevTools Protocol method to a browser window's page, from a short list that reads and drives the page, and `domicile mcp` offers agents browser tools on it: `browser_snapshot` reads the page's accessibility tree, and `browser_click`, `browser_type`, `browser_key`, `browser_navigate` and `browser_screenshot` act on its elements by ref. `list-windows` gives a browser window's `engine_id`. Private windows are never driven.
- 996cc29: A shell can hear when nobody has been at the desk for a time it chooses (`session.idleAfter`), or a time before the screens blank (`session.idleBeforeBlanking`). These replace `session.idleWarnings` and the `idle.warn_before_seconds` setting, which are gone.
- 3e37020: A client asking to be minimized now reaches the shell as `WindowRequest.Minimize`. The shell can also set `WindowState.Resizing` on a window while it resizes it, and the client sees `resizing` in its configure.
- 38a59f4: `domicile logs` prints every part's logs, from the journal or, off it, the newest 10,000 lines the desktop kept. `domicile export-logs` writes them to one file to attach to a bug, with the desktop's version, shell, displays and inputs, and with web addresses and window titles hidden unless `--show-everything`.
- 60e7c7e: Settings shows "Not supported" in place of the HDR switch for a plugged-in monitor that can't show HDR. It learns which monitors those are from the new `which_monitors` question, which the compositor answers with each lit monitor's names and HDR state.
- 17236a3: Electron apps hear `session.cookies`' `changed` event, so Slack finishes signing in after "Open Slack" on its website.
- 2a1913f: A display profile can set a monitor's mode and refresh rate. `mode: [W, H]` now lights the monitor at that size, refusing the profile when the monitor does not offer it, and the new `refresh` (in Hz) picks the nearest rate the monitor offers. The SDK's `Display` gains `refreshMhz`, the rate the monitor scans out at.
- cd75f9a: Picture-in-picture video works: a video's picture-in-picture button, or a site's, floats the video over your windows in the corner of its screen. Drag it to move it, drag an edge to resize it, and point at it for play, pause, track, back-to-tab and close controls. Shells list the videos in `domicile.pictureInPicture` and show one with `<app picture-in-picture="id">`.
- 02708ac: Windows can draw in 10-bit (`ARGB2101010`, `ABGR2101010`) and half-float (`ABGR16161616F`) formats, over dmabuf and `wl_shm`, and keep their extra precision on the page. Over `wl_shm` they can also draw in `XRGB2101010`, `XBGR2101010` and `XBGR16161616F`. Output stays 8-bit for now.
- c454256: A display profile can drive a monitor in HDR (HDR10) with `hdr: true`, and set how bright ordinary content's white is there with `sdr_white` (203 cd/m² by default). It is off by default and used only where the monitor's EDID takes PQ and its connector scans out in 10 bits. The SDK's config types gain both fields, and Settings reads profiles that set them instead of refusing them.
- 09a3ad4: The profile menu switches the page's profile's extensions on and off. Every profile now has every extension the config names, switched on or off in it, so one switched off keeps its data. A profile whose config names its `extensions` has those switches locked to the config; any other starts each extension on (off in a private profile) and leaves it to the user. Shells get `browser.setExtensionEnabled(profile, id, enabled)` and each profile's `extensions`, `enabledExtensions` and `lockedExtensions`.
- f268f2d: A shell can open a scheme's links itself: `domicile.shell.links(["mailto"])` claims them, and `domicile open` (so `xdg-open` and apps' links) and the Email portal hand them to the shell instead of an app.
- fb07c3f: The config takes a `browser` section: browser profiles, the default and default private profile, and the profile each site opens in. Nothing acts on it yet.
- 24b88fb: Dragging the title bar or edge an app draws itself, such as a GNOME app's header bar or Firefox's tab strip, moves or resizes its window. The compositor checks the press is still held, takes it from the app, and reports `WindowRequest.Move` or `WindowRequest.Resize` (with a `ResizeEdge`); Manganese runs the drag as it does a Meta drag.
- 81215c5: A shell can name any window to a capture tool. Each window's `toplevelId` and each browser window's `toplevelId` is its identifier on `ext-foreign-toplevel-list-v1`, so a shell can hand it to a tool such as `grim -T` instead of matching by title. The compositor sends a native window's on `app_appeared` and the browser windows' on `browser_toplevel_ids`.
- 53319a2: The engine registers Electron apps' own schemes as it starts, from `--domicile-electron-schemes=app:standard,secure;…`, with Electron's names for the privileges (`standard`, `secure`, `bypassCSP`, `corsEnabled` and `supportFetchAPI`). Every child process gets the switch, so a URL parses the same in each. The Electron socket's `ready` names the schemes registered and their privileges. See docs/architecture/ELECTRON-APPS.md.
- d566f68: A cursor an app draws itself, such as a game's, an image editor's brush or a VM viewer's, now shows in place of the arrow. The compositor sends each image the app commits as a PNG on `app_cursor`, and `DomicileWindow.cursorImage` gives it to the shell as a CSS `cursor` value. Manganese sets it on the window's element.
- 86c57d9: An agent let reach the entire desktop can be remembered, and comes in without asking from then on. A running agent's reach can be changed from the bar, and Settings › Agents lists every agent connected or remembered, to stop or forget. `domicile list-agents`, `stop-agent` and `forget-agent` do the same. The SDK adds `PortalAnswer.Agent(reach, remember)`, `PortalAnswer.Change()`, the dialog's `current` and `remembered`, `portals.changeAgent`, `portals.agents` and `portals.forgetAgent`; `AgentDialog` draws the Remember switch and the change dialog, and the capturing indicator and Manganese's bar a Change button.
- 057faa5: The night light fades in and out instead of snapping, on every monitor including DisplayLink docks. `setColorTemperature` fades from the color drawn.
- 51a769e: `browser.clickMatch(id, selector)` and `<webview>.clickMatch(selector)` click the first shown element in a page matching a CSS selector, as a press of the mouse's main button does, and resolve whether one matched.
- 52e71af: Private windows are a private browser profile's: its extension switches say what runs there. The config's `extensions.settings.<id>.private` is gone, and a config that sets it is refused; so are the SDK's `inPrivate` on installed extensions and in `configureExtension()`, and the Settings app's and tray's "Allow in private windows". The tray now shows the extensions of the last focused page's browser profile ("Extensions in Work"): its icons are those switched on there, and its switches switch them in that profile, locked where the config sets them.
- dd0fb71: Games and VM viewers can read how far the mouse moved (`zwp_relative_pointer_v1`), to turn a camera or drive a guest's mouse. A shell's pointer warp sends no relative motion. Locking and confining the pointer come next.
- a77b1e0: Electron apps whose windows ask for Node.js in their pages (`nodeIntegration`, or `sandbox: false`) now run on Domicile's engine instead of falling back to their own Electron. Such a page gets its own unsandboxed renderer with Electron's Node in it, as Electron gives it; every other page stays sandboxed.
- 3662ef0: `domicile mcp` offers `stop_using_desktop`, so an agent done with the desktop ends its own session and leaves the bar. Its next tool call asks again.
- 88a822a: `domicile accessibility` prints a native window's AT-SPI accessibility tree, and `accessibility-act` clicks, focuses or sets the text of its elements by ref. `domicile mcp` offers them to agents as `app_snapshot`, `app_click`, `app_focus` and `app_set_text`, which work on hidden windows.
- 3698ea1: An agent stopped from the bar, or turned away, can ask again: `domicile mcp` offers `ask_to_use_desktop`, which shows the dialog again, so an agent that stays connected, such as one on claude.ai, isn't stuck refused until its session ends. After a stop, a remembered agent asks too, so a stop holds until the user says otherwise.
- 44c2ed4: Add `domicile subscribe [windows|displays|inputs|status]...`, which prints the desktop's windows, displays, input devices and status as JSON lines, then each again whenever it changes, like `swaymsg -t subscribe`.
- 5c11ddc: `domicile list-bindings` prints the running shell's keys and gestures in each
  binding mode and what they run. A shell command can now answer, and
  `domicile send-shell` prints the answer: Manganese's `get-workspaces` and
  `get-tree` answer with JSON, as `swaymsg -t get_workspaces` and `get_tree` do.
  
  Breaking: `onCommand` may return `Ok({ output })`;
  `shell.commands(help, bindings)` takes the bindings, which `bindKeys`
  describes for you; and `shell.answer(sent, ran)` takes the command's `Result`.
- 8c477cc: Name a monitor to turn only that one off, like `domicile sleep-displays DP-1`. It keeps its windows and workspace, and stays off while you use the others until `domicile wake-displays DP-1`. Shells pass the name to `displays.sleep()` and `displays.wake()`.
- a32a432: `domicile pointer`, `scroll`, `key`, `type` and `screenshot --fit` send input to the desk and see it, and `domicile mcp` offers them to agents as computer-use tools.
- 8e37f79: `domicile list-displays` prints each display with every name `sleep-displays`
  takes for it, its mode, layout, HDR and whether it is lit. `domicile
  list-windows` prints every window, native and browser alike. Both take
  `--json` for scripts.
- 202f8a5: An Electron app's `webContents` hears its page: `console-message`, `preload-error`, `unresponsive` and `responsive`, HTML fullscreen, media and sound (`audio-state-changed`, `isCurrentlyAudible`), favicons, `update-target-url`, `zoom-changed`, `did-change-theme-color`, `cursor-changed`, `preferred-size-changed` and `content-bounds-updated`. `before-input-event` and `before-mouse-event` can cancel the page's input, `input-event` hears it, and `sendInputEvent` sends it. `setAudioMuted`, `setUserAgent` and `setIgnoreMenuShortcuts` act on the page instead of doing nothing.
- bb9f4be: Apps can describe their colors with `wp_color_management_v1`: wide-gamut (Display P3, Adobe RGB, BT.2020) and HDR (PQ, HLG, scRGB) windows are drawn in the colors they mean rather than as sRGB. Every display still describes itself as sRGB until HDR output lands.
- befeb71: Gmail and Messages inboxes, the Gmail bar module and launcher bookmarks take a `profile`, the browser profile they open in, so two Gmail accounts can live in two profiles. A site's app window is now in a browser profile, its site's by default, and `domicile open --app --profile <id>`, `browser.openApp(url, { profile })` and `browser.fetch(url, { profile })` pick one.
- 4a4f057: Electron apps on the engine behave more like their own Electron:
  
  - Closing a window asks the app first, so an app that closes to its tray, as Slack and Element do, keeps running there instead of quitting.
  - `win.hide()`, `win.show()` and `show: false` hide and show a window, its page still running. The engine lists a hidden window with `isHidden`, and Manganese keeps it off every workspace until its app shows it.
  - A window's own title (`setTitle`, or `page-title-updated` prevented) is the one the desktop shows, so Claude Desktop reads "Claude", not "index.html".
  - `ipcRenderer` is an EventEmitter, so `ipcRenderer.emit` reaches the preload's own listeners. Element's preload calls it as it starts, and showed "Unable to load config file" without it.
  - Manganese draws an app window with its app's icon, in its title bar and in the screenshot and screen cast pickers, instead of its page's.
  - A window has the properties Electron gives for what its methods set: `autoHideMenuBar`, `menuBarVisible`, `fullScreen`, `resizable` and the rest, and its page `audioMuted`, `backgroundThrottling` and `userAgent`. Element reads `autoHideMenuBar` once its page loads.
- 9747fd9: An Electron app's `session.webRequest` listeners see its windows' network requests. `web_request_listen` names a session's events; each request then meets them as `web_request` lines, and `onBeforeRequest`, `onBeforeSendHeaders` and `onHeadersReceived` wait for `web_request_answer`, which may cancel, redirect, or replace the request's or the response's headers. See docs/architecture/ELECTRON-APPS.md.
- 60d225a: Add `domicile configure-display <display> <change>...`, which changes a monitor's mode, scale, position, rotation, adaptive sync, HDR and SDR white, or turns it on or off, until the desktop restarts, like `swaymsg output`. `reset` goes back to the config. The changes are laid over the profile that matches the plugged-in monitors, so a hotplug or a config edit keeps them.
- ebfad4b: A site's "Sign in with" account chooser (Sign in with Google and other account providers) now works, drawn by the shell: over the page after you press the site's button, or in the page's corner when the site offers it on load. Shells get it as the `domicile-identity` event on a browser window's element.
- 1036a91: Settings has a Troubleshooting page: **Detailed logging** turns on debug logging until the desktop restarts, and **Save logs** saves `domicile export-logs` to Downloads, with web addresses and window titles hidden unless you turn that off.
- 40c901e: Quiet by default: the compositor and the launcher log errors alone, and a desktop says one `domicile is up.` line with what it chose and its control socket (`DOMICILE_SOCK=` at its end), and `domicile is down:` when it ends cleanly. `domicile set-log-level` turns them up.
- bf01c26: An Electron app's preload has `ipcRenderer.sendSync` and `ipcRenderer.postMessage` with message ports. `sendSync` reaches the app as `ipc_send_sync`, and the page waits until the app's `ipc_reply`. Ports travel both ways: `ipc_post` carries a message and the ports that went with it, `port_post` and `port_message` carry what goes over a port, and `port_close` and `port_closed` say when one end closed. `page_gone` says a new document replaced a window's page, taking its ports. See docs/architecture/ELECTRON-APPS.md.
- 321a9b0: Add `domicile lock`, `focus-window <id>`, `close-window <id>`, `kill-window <id>` and `inhibit-idle -- <command>`. The window commands take the ids `list-windows` prints. `focus-window` asks the shell to show and focus the window, the same request an app's activation makes. `inhibit-idle` keeps the screens on until the command exits.
- ed4f85a: A monitor driven in HDR now describes itself to `wp_color_management_v1` clients as HDR10 (BT.2020 with PQ, its SDR white as reference, and its panel's black and peak as the target), instead of sRGB. A window prefers the description of the monitor holding most of it, and its client hears `preferred_changed` when the window moves to a monitor in a different mode or that monitor goes into or out of HDR; each output object hears `image_description_changed` then too.
- b10e007: The night light now works on a monitor driven in HDR. A gamma ramp there would bend the PQ curve the panel decodes, so the monitor keeps an identity ramp and the night light becomes a color matrix viz applies in linear light (`domicile_displays_set_color_matrix`). `wlr-gamma-control` clients get `failed` on such a monitor, since their ramps assume SDR.
- ec46c2d: An Electron app's sessions take `session_call`s: `cookies.get`, `set`, `remove` and `flushStore`, `clearStorageData`, `clearCache` and `setUserAgent`, each answered by a `session_result`. They act on the session's own partition, and a session's user agent reaches its windows' pages. See docs/architecture/ELECTRON-APPS.md.
- 69247ca: The tray has a menu of every icon at its end. Pin or unpin any app or extension icon, switch extensions on and off, and change what each can do: its options, which websites it can read, private windows, local files and user scripts, or uninstall it. Settings your config sets show locked. Shells get the same through `domicile.extensions.installed`, `setEnabled`, `configure` and `uninstall`. `Menu` holds check, radio and submenu items, and `ListRow` takes `actions` beside a pressed row.
- bc8db8f: Remove a copy from the clipboard history: `clipboard.remove(id)` in the SDK, and a Remove button and the Delete key in manganese's clipboard panel. Each entry says whether it is `current`; removing the current one empties the clipboard.
- e821d1f: A display profile can turn on adaptive sync (variable refresh rate, FreeSync, G-Sync Compatible) per monitor with `adaptive_sync: true`. It is off by default, asked for only where the monitor and driver report support, and retried without it when the driver refuses the modeset. The SDK's `Display` gains `adaptiveSync` (`unsupported`, `off` or `on`), which says what the hardware is doing. Settings now reads profiles that set `refresh` or `adaptive_sync` instead of refusing them.
- 4c6346e: An Electron app's windows load through its sessions and protocol handlers. `open_window` names a window's session, a partition inside the app's own. `handle_protocol` and `unhandle_protocol` send a session's requests for a scheme to the app as `protocol_request`, which the app answers with `protocol_response` (a whole body, a file, or a stream of `protocol_data` ending in `protocol_end`). A window opens a `file:` URL, or one in the app's own scheme, once its session handles that scheme, which is how `loadFile` works; `http` and `https` go to the network unless the session handles them. See docs/architecture/ELECTRON-APPS.md.
- 46d7737: Settings › Agents › Connect from the web turns on `agents.web`, which has the desktop run `domicile mcp --relay` so agents on the web, such as claude.ai, can reach it. Settings shows the desktop's address to copy into the agent, whether it is ready, and each agent signed in, with Sign out.
- eeb828a: Electron apps can share the screen. `desktopCapturer.getSources` gives one source the desktop's share picker stands for, as Electron does under Wayland, and a page's `getUserMedia()` with `chromeMediaSource: "desktop"` opens that picker, with the source's sound when asked. `session.setDisplayMediaRequestHandler` is accepted, and `getDisplayMedia()` opens the same picker, as Electron's `useSystemPicker` does.
- 8ff882e: Extensions can run in private windows. Each extension's chrome://extensions settings are now yours to set: whether it runs in private windows and on local files, whether it may run user scripts, and which sites it runs on (when you click it, on specific sites, or on all sites). Set them in the config's `extensions.settings`, by extension id, or in the Settings app, which shows the ones an extension can use while it is on and moves Options and Uninstall to the bottom of its row. A setting the config drops goes back to Chrome's default.
- c5712b3: Electron apps on the engine get `webContents.executeJavaScript` and `webContents.mainFrame`, a `WebFrameMain` for the page's one frame. Claude Desktop calls both as it starts, and ran on its own Electron for want of them.
- 7e433e1: The engine takes Electron apps on a new socket, `--domicile-electron-socket`, which the desktop passes and names to apps in `DOMICILE_ELECTRON_SOCK`. An app's `electron-host` says hello and opens app windows in the app's own partition, and hears each window load, change its title and close. See docs/architecture/ELECTRON-APPS.md.
- ffa2e05: `domicile mcp --relay` serves agents on the web, such as claude.ai, through Domicile's relay at `mcp.domicile-desktop.com`, or another. The desk dials out, gets an address named for its own key, and gets its own Let's Encrypt certificate for it, so TLS ends on the desk and the relay can't read what agents say. Signing in and asking on the desktop work as with `--http`.
- b9c14d1: Pages and the shell now compose text from an input method such as fcitx5 or
  IBus, as native windows do. Its candidate list does not show over them yet.
- 6e41263: An Electron app's window can ask for the user's attention, let the pointer through and take a shape (`flash_frame`, `set_ignore_mouse_events`, `set_shape`), listed to the shell with the window; the mouse's back and forward buttons reach the app (`app_command`); a page captures one of its app's windows by its `getMediaSourceId`; and an app opens `about:blank` and `data:` pages.
- 0a4d218: The SDK's `Display` gains `hdr` (`unsupported`, `off` or `on`), `peakLuminance` (the panel's peak in cd/m², zero when its EDID reports none) and `sdrWhite` (the white SDR content is shown at while HDR is on), so a shell can offer HDR only on the monitors that take it.
- 0099cfa: Shells and app modules are now cross-origin isolated, with no COOP or COEP headers: `crossOriginIsolated` is true and `SharedArrayBuffer` works, so threaded wasm and tools like the TypeScript language service run. Nothing they load is checked for CORP. Pages in a `<webview>` are unchanged.
- 9c805c4: Back and Forward list the pages that way on a long press or right click, as in Chrome. `<webview>` gains `history()`, `goToHistoryEntry()` and `goToHistoryEntryInNewWindow()` for shells' own menus.
- ff5a1d0: `domicile list-windows` marks private browser windows, and its `--json`
  gives each browser window's address (`url`) and whether it is private.
- 9bd54ab: The config can name a terminal with `terminal`, such as `["kitty"]`. When it does, applications that run in a terminal, such as htop and vim, show up in the launcher and under "Open with", and `domicile open` runs them in it. Meta+Return opens it in Manganese. Without one, nothing changes: Domicile still has no default terminal.
- 5857069: An Electron app's `setPermissionRequestHandler` answers its pages' permission requests in place of the shell: the engine sends `permission_request` while a session has a `permission_handler`, and the page gets the app's `permission_answer`. See docs/architecture/ELECTRON-APPS.md.
- a2cab16: `domicile exec <program> [<arg>...]` and the SDK's `KeyAction.Exec` start a program for any shell, found on the desktop's `PATH`, and say why when it does not start; a key's failed start is a notification. Manganese's `exec` command is gone: its `exec()` builds `KeyAction.Exec`. `domicile drag` replaces `pointer press`/`release`, which let go as each command ended, and `domicile type` presses Return for a line break. The MCP server gains an `exec` tool, and its `drag` holds the button.
- 65e63db: Agents read and drive an Electron app's views, which `list-windows --json` lists under its window and `devtools --view` reaches, and `screenshot --fit --area` zooms into part of the desk.
- 1f229ad: An input method's candidate list now shows just under the text cursor in
  native windows, moves with the cursor as you type, and goes above it near the
  bottom of the screen.
- 047dc57: `domicile mcp --http <address>` serves the Model Context Protocol over Streamable HTTP, for agents that connect to a URL. They sign in with OAuth, which `domicile mcp` serves itself, by entering a code the desktop shows in a notification; each session still asks on the desktop before it uses anything, and ends after 30 minutes unused.
- 09be8b7: Text fields in pages, web apps and Electron apps check spelling, in American English unless the config's `spellcheck.languages` says otherwise. The dictionaries ship with the engine and are never downloaded. A context menu event over a misspelled word carries `misspelledWord`, `spellingSuggestions` and `replaceMisspelling()`, and runs `add-to-dictionary`; manganese puts the suggestions at the top of the field's menu.
- da632d6: A shell can give you a way back from a VM or remote desktop viewer that holds your shortcuts. A chord bound `--inhibited Meta+Escape` stays the shell's while that window has the keyboard, and `keyboard.switchShortcutsInhibitor` turns the window's hold off and on. Manganese has a `shortcuts-inhibitor toggle` command to bind to it.
- 9b20adc: Capture tools that pick a window from the toplevel list, such as `grim` and
  `wf-recorder` through `ext-image-capture-source-v1`, now see browser windows
  too, and capture a browser window's page alone.
- 85ad296: Electron apps' menu bars reach the shell. The Electron socket sets a window's menu with `set_menu_bar`, and a browser window list includes it as `menu` (the entries as JSON), with `menuBarVisible` and `menuBarAutoHide`. A shell clicks an entry with `clickBrowserWindowMenu`, and the app hears `menu_clicked` with the entry's id. A `<webview>` also fires `domicile-guest-keyup` for a modifier let go of in its page, so a shell can tell an Alt tap from Alt held for a chord.
- 539ce11: An agent that signs in, such as claude.ai, no longer asks for a code: its page waits while the desktop asks "Let Claude sign in to your desktop?", and **Allow** signs it in.
- e4f3394: Right-click a video for "Picture in picture", and drag a picture-in-picture video's progress bar to move through it. Shells get the menu's `picture-in-picture` action with `canPictureInPicture` / `inPictureInPicture`, and `pictureInPicture.seek(id, seconds)`.
- e7b707c: The profile menu pins a site to a browser profile, so it opens there from now on. The engine keeps the pins across restarts, under the config's own `browser.sites`: a site the config names shows locked. Shells get `browser.pin(site, profile)`, `browser.siteFor(url)` and each profile's `pinnedSites` and `configSites`.
- 8a2777f: Electron apps' views (`WebContentsView`) reach the shell. The Electron socket opens a view with `open_window` and `"view": true`, and places a window's views with `set_views`. Each page's size goes back to the app as `resized`. A browser window list includes each view right after the window that holds it, with `parent`, `x`, `y`, `width`, `height` and `isHidden`, so the shell can draw it where its app asks or lay it out its own way.
- 291a7ee: An Electron app's window runs its preload. `open_window` on the Electron socket takes the preload's source, which the engine runs in its own isolated world before the page's scripts, with `require("electron")` giving it `contextBridge.exposeInMainWorld` and `ipcRenderer`. `ipcRenderer.send` and `invoke` reach the app as `ipc_message` and `ipc_invoke`, the app answers with `ipc_reply`, and `ipc_send` reaches the page's listeners. `sendSync` and message ports are not there yet. See docs/architecture/ELECTRON-APPS.md.
- 756c1bd: `domicile list-shell-commands` (also `send-shell --help`) prints the commands
  `send-shell` takes, as the running shell describes them. `send-shell` now fails
  with the shell's reason when the shell refuses a command or never says it ran
  it, instead of always succeeding.
  
  Breaking: `bindKeys` takes `commands`, describing what `onCommand` runs, and
  `onCommand` returns `Ok("ran")` or `Err(reason)`. `shell.commands(help)`
  replaces listening without a description, and `shell.answer(sent, refused)`
  reports how each command ended. Manganese describes all of its commands.
- 9ad6193: The night light now warms monitors with no gamma table, such as a DisplayLink dock's.
- 133ce8a: Browser profiles have an order. The config's `browser.order` lists profile ids, and the profiles it leaves out follow by id. The compositor sends the profiles in that order, so the profile menu and Settings list them that way.
  
  Settings' Profiles page moves a profile up or down. After its swatches, a color well takes any color, and the swatches now include the theme's cyan.
  
  In the profile menu, middle-clicking a profile opens the page in a new window of that profile, using `ListRow`'s new `onMiddlePress`. The profile button writes its name in black on light colors, where white would be hard to read.
- b95da52: An agent asks before it drives the desktop. `domicile mcp`'s first tool call runs `domicile agent`, which puts an `agent` dialog to the shell: the entire desktop, or only the windows the user checks. Every tool call after is checked against the answer, and the agent is listed as an `agent` capturing session, with what it did last, until it disconnects or the user stops it. The SDK parses them as `PortalKind.Agent`, `PortalAnswer.Agent` and `CapturingKind.Agent`; `<PortalDialogs />` draws the dialog and takes `omitAgents`; Manganese's bar shows each agent as a violet pill with a Stop button.
- 3d4b329: An Electron app's `setWindowOpenHandler` decides on its pages' new windows (`window.open`, `target="_blank"`, a middle click) before any opens. A denied window opens nothing, so a link the app hands to `shell.openExternal` opens in the user's browser with their sign-ins, not in the app's storage; an allowed one is a new `BrowserWindow` of the app, and `did-create-window` fires. `electron.profiles`, `domicile open --electron --profile` and the guess that sent noopener links to the browser are gone.
- 53ff70a: `domicile dev <entry>` serves a shell from its source with hot module replacement: an edit applies as you save, and with React Fast Refresh the shell keeps its state. Ctrl-C goes back to the shell it replaced. The engine reaches the builder's Vite dev server over a private socket, so no port opens.
- 9478a19: Pages open in the profile of their site: the most specific of the config's `browser.sites`, or the default profile. A link, the address bar or back and forward to a site of another profile moves the window's page there in place, keeping its window and its history. Shells get `reopenBrowserWindow(id, profile)` to move a page by hand and `browserProfileFor(url)` to ask where a site goes.
- a85afe8: Electron apps' message boxes reach the shell. The Electron socket asks a box over a window with `show_message_box`, and a browser window list includes the box it shows as `messageBox` (JSON), one at a time. A shell answers with `answerBrowserWindowMessageBox` (`browser.answerMessageBox` in the SDK), and the app hears `message_box_answered` with the button and the checkbox. A window that closes answers its boxes with their cancel buttons.
- 0bb6681: `domicile` prints grouped help, `domicile help <command>` and man pages (`man domicile`), and colors its tables and errors on a terminal unless `NO_COLOR` is set. `--json` output is unchanged.
- a188e78: `domicile idle-time [--json]` prints how many seconds nobody has used the desktop. Electron apps read it for `powerMonitor.getSystemIdleTime` and `getSystemIdleState`, so Slack and the like can mark you away.
- 689c56a: `domicile open --electron <entry|path> [-- <command>...]` runs an installed Electron app on the desktop's engine instead of the Electron it ships. It follows the app's desktop entry, through the wrapper scripts packages put around Electron, to the app's `app.asar`, and runs it with `electron-host`, which now ships with Domicile. An app whose page needs Node runs on its own Electron instead, with a notification saying so.
- d921f45: The engine now builds Electron's Node against its own V8 and BoringSSL, as Electron does, with Electron's patches to Node, V8 and BoringSSL. It is the first step toward Electron apps whose pages use Node running on the engine.
- 25522ef: Set how held keys repeat with `input.keyboard.repeat` (`delay_ms`, `rate`; 0 turns repeat off). Native windows and pages follow it, and a reload applies it without resending the keymap. The default is 500 ms and 25 a second.
- 19cc2c5: Tapping Super on its own opens and closes the overview, as it does on GNOME and KDE. Holding Super for a shortcut, a drag or a scroll still works as before. Shells can bind a tap of any modifier alone by writing just its name, such as `Meta` or `Alt`, in their keybindings.
- a5ade39: Games and VM viewers can lock the pointer (`zwp_pointer_constraints_v1`). The compositor offers the lock to the shell for the window under the pointer as `pointerConstraint`, and tells the client only once the shell holds a pointer lock on the window's `<app>` and reports it with `windows.pointerConstrained()`. The engine grants a shell's pointer lock with no click first and no browser bubble. Manganese locks for the focused window and lets go when the keyboard moves away. Confining the pointer to a window is offered but not taken yet.
- 5315b06: A video entering picture-in-picture grows out of its place in the page, and "Back to tab" shrinks it back in. Shells read where it was from the video's `source`.
- 19c8343: `domicile mcp` serves the Model Context Protocol on stdio, so agents such as Claude Code can drive the running desktop.
- 8f45df8: `domicile --version` prints the version, the commit it was built from, and the engine's release. A flag `domicile` doesn't take is refused with a short message, rather than passed to the shell builder as a shell.
- 0d72a18: Electron apps on the engine control their pages: `insertCSS`, `executeJavaScriptInIsolatedWorld`, `reloadIgnoringCache`, `capturePage`, `printToPDF`, device emulation, frame subscription, `copyImageAt`, `copyVideoFrameAt`, `adjustSelection`, caret browsing and the WebRTC IP handling policy. Windows have parents, modals and `setEnabled`, and `getProcessId`, `isWaitingForResponse` and the frame lookups (`webContents.fromFrame`, `webFrameMain.fromId`, `fromFrameToken`, `focusedFrame`) answer from the page.
- 6aad1fa: CSS `zoom` on an `<app>` zooms a native window's content and keeps it sharp: the client draws at its display's scale times the zoom, at a logical size that much smaller, so its buffer still fills the box. Popups share their window's zoom.
- 78f8fbf: A local shell's `package.json` can name its prebuilt module, as a package's does: `"domicile": { "shell": "dist/shell.js" }`. `domicile ./my-desktop` serves it, and a module named there is never sent to the builder.
- 947e5d3: Input methods such as fcitx5 and IBus now compose text in native windows:
  preedit shows inline as you type, and the text you pick is committed. On-screen
  keyboards and other tools that type through `virtual-keyboard-v1` work too. The
  candidate list is not shown yet, and pages and the shell do not compose from an
  input method yet.
- cda79ce: An Electron app's own schemes (`app://` and the like) now reach the engine. When an app registers a scheme the engine doesn't have yet, `electron-host` keeps it in `$XDG_STATE_HOME/domicile/electron-schemes.json` and the app runs on its own Electron this time; from the next engine start, `domicile` registers every kept scheme and the app runs on the engine.
- d405cb2: Electron apps now draw their own right-click menus, as on Electron: a page's context menu reaches its app as webContents `context-menu`, so Claude Desktop's, Slack's and Element's menus show.

### Patch Changes

- b90df3a: Web agents' calls through the relay no longer wait ~40 ms on each TCP acknowledgment: the relay, the desk and `domicile mcp --http` set `TCP_NODELAY`.
- d739269: The launcher treats `SIGHUP` as a stop: logging out of a tty login ends the graphical session, so units bound to `graphical-session.target` stop with the desk.
- 6c60aa9: `domicile devtools shell` reaches the shell's own page again: the desktop no longer looks "shell" up in list-windows before handing it to the engine, so agents' browser tools can read the shell's bars and panels.
- 85aee4f: Extensions the config installs, or the user installs in another profile, keep their data across restarts: Chrome no longer uninstalls them at every start.
- d57e6f6: Settings shows each extension's own icon, on the Extensions page and on each profile's card, instead of its initial, which stays for an extension without one. A profile card lists its extensions in two columns at most, so their names fit. The engine's extension list names each extension's icon file, which `domicile-app-host` hands to Settings as an image.
- 65f5ebc: Prebuilt engines and the newest `stable` packages are published in `cprussin/domicile-builds`, and builds older than a week are pruned, so watching `cprussin/domicile` notifies only of real releases.
- d3978bb: Electron apps' views show in their windows. The SDK lists them in `domicile.browser.views`, apart from `domicile.browser.windows`, so window lists, task switchers and tiling never treat a view as a window. Manganese draws each view over its window's page where its app asks, hides it while the app hides it, treats a click in it as a click in the window, and runs the app's menu keys pressed in it.
- 00b45bb: Electron apps hear their pages' navigations, as Electron's `did-start-navigation`, `did-navigate`, `did-fail-load` and the rest, and `will-navigate`, `will-frame-navigate` and `will-redirect` can stop one. A `beforeunload` that asks to stay asks the app's `will-prevent-unload` instead of the shell. `navigationHistory.restore` and `removeEntryAtIndex` work.
- 96c45d2: An Electron app's sandboxed preload gets the rest of Electron's `electron` module: `webFrame` (the main frame, with `frameToken`, `top`, `insertCSS`, `removeInsertedCSS` and the zoom), `crashReporter`, and `webUtils` and `nativeImage`, whose calls say they don't work yet. Its `process` has `isMainFrame`. A window's `webPreferences.additionalArguments` reach its page's `process.argv`, which the host sends as `open_window`'s `arguments`. Claude's preloads need all of these: without them they set up nothing, and claude.ai showed its web layout.
- c01a887: `domicile load-shell` to another shell drops the old shell's shortcut claims. Chords only the old shell claimed reach the focused window again.
- e6daba0: The engine is built on Chromium 160.0.8174.0.
- d765a9f: An Electron app's sessions fire `preconnect` and `spellcheck-dictionary-initialized`, emulate network conditions with `enableNetworkEmulation`, and keep their code cache where `setCodeCachePath` says. The app fires `gpu-info-update`, and has Electron's main-process `WebSocket` and `contentTracing.enableHeapProfiling`.
- c62a091: A site's notification carries the site's favicon as its application icon, instead of the browser's logo, so a page that gives no icon of its own is drawn as the site.
- 67875a1: Shells and apps can start Web Workers, dedicated or shared, classic or module, from their own files.
- ead2330: A monitor whose page flip never finishes, as a DisplayLink dock's can, no longer freezes the whole desktop.
- d6d5370: When the desktop falls back to drawing without the graphics card, Domicile now says so in a notification with a "Report it" button, and logs an error.
- 46aca63: A window on another workspace or behind a tab no longer keeps the display compositor waking at the screen's refresh rate, which kept the panel from saving power while idle.
- 1eb4799: An Electron app's sandboxed preload gets `process.versions.electron` and `process.resourcesPath`, which the host now sends in `hello` for every page, not only Node's. `webFrame.insertText` types at the page's focus, `webFrame.setVisualZoomLevelLimits` sets pinch zoom's limits, and the rest of Electron's renderer `process` (`contextId`, and calls such as `getCPUUsage` that say they don't work yet) is there, so a preload no longer finds `undefined` where Electron has an API.
- d59061f: The engine is built on Chromium 160, with its fixes and web platform updates.
- e713589: An Electron app hears its pages' `login`, `certificate-error` and `select-client-certificate` and answers them, and a `ClientRequest` hears `login`; a sign-in no listener takes still asks through the shell. Sessions gain `clearData`, `clearAuthCache`, `clearCodeCaches`, `resolveHost`, a working `preconnect`, `getStoragePath` and `storagePath`, the shared dictionary calls, `registerPreloadScript` and its kin, and a `serviceWorkers` that knows the running workers and fires their events.
- 0246a64: On a console, the pointer shows the desk's cursor theme right after undocking, instead of Chromium's own cursor until it passes over a native window.
- 193c954: On a console, the pointer keeps the desk's cursor theme when a monitor at another scale appears, such as after undocking. Until the theme loads at the new size, the nearest size already loaded stands in, instead of Chromium's own cursors. A pointer theme that falls back to Chromium's cursors now says why in the journal.
- 75410e6: A window is black, not white, until its page's first frame, so the desktop no longer flashes white between the boot screen and the shell.
- 55b0b45: GTK3 apps and Firefox no longer burn CPU asking to draw their own window frames over and over.
- 03dcccf: Holding Super for a moment and letting it go no longer opens the overview: only a quick tap, up to 300 ms, does. Shells can set another limit with `keyboard.grab("Meta", { longestTap })`.
- d15f3e6: A page that stays fullscreen after leaving it, so its window looks stuck, is now a bug Domicile reports: a notification with a "Report it" button, and an error in the log.
- 5ef4689: Typing in a window ends a group selection (Meta+A) around it. `<app>` and `<webview>` fire `domicile-key-delivered`, which names no key, for each key press their window gets.
- 44f2b63: A screenshot or screen cast of an Electron app's window shows its views, such as Claude's chat, where the app placed them, instead of only the page under them.
- 9ab7029: Focusing a popup focuses the window under it, so a click that focuses a native menu (Qt, GTK) no longer closes it before the click arrives.
- aa797e7: A page, browser window or move to a browser profile that is still loading now waits for it to load, instead of blocking the desk while it reads the profile from disk.
- 1f24dcd: The engine's logs for a page stuck at an old size say more about where its frames stopped: where its tiles' raster tasks are (queued, running, finished but never collected, or waiting on an image decode), what its scheduler is waiting on, and, when it gets no begin frames, why the GPU process sends it none.
- 771ba77: The night light warms the pointer on a monitor with no gamma table, such as one on a DisplayLink dock, instead of leaving it white and looking blue on the warm screen.
- e6daba0: Update dependencies.
- d032b0b: `domicile set-log-level trace` logs every message between the desktop and the shell, each commit and frame, configures, popups, monitors and control commands, each naming its window, surface or display.
- d2a68f5: `domicile sleep-displays <name>`, `wake-displays <name>` and a shell's per-display white point find a monitor by any name a profile matches: its connector (`eDP-1`), its panel (`BOE NE135A1M-NY1`) or its output name (`drm-<id>`). Before, a monitor with an EDID name answered only to `drm-<id>`. A name that matches no display, or several, fails listing every display's names. Profiles also match a monitor by its connector.
- 607db5b: An Electron app's downloads go where its session's `will-download` says, and its `DownloadItem` hears how they go, so Slack's downloads save instead of sitting as hidden temporary files.
- 274e12d: Night light and other color ramps set right after startup or a monitor change now stick, instead of being dropped until the next modeset.
- 3c6a947: At `domicile set-log-level debug`, the engine logs each window's embed and frame sink, monitors as it reads them, Electron apps' requests by type, and extension windows; at `trace`, each buffer imported and submitted.
- a575c6d: Sleeping or waking the monitor that hosts the desktop (usually the laptop panel) no longer moves the pointer to another monitor, so focus stays on the window you were using.
- fdc9064: Locking the desktop ends an application's held global shortcut, such as push-to-talk, instead of leaving it active until the next press.
- 9d0d2a1: On the power-saver profile, only browser windows you aren't using drop to 30 fps. The shell, native windows, Electron apps and the focused page keep their full frame rate.
- ada112b: A PDF no longer goes blank after you switch away from its tab and back.
- 183d286: A window's buffer the GPU read on several streams no longer crashes the compositor. A crashed compositor now restarts: the processes it started no longer hold its connection to the browser open.
- f658eb3: Each frame tells a DisplayLink dock only the part of the screen that changed, so its driver should use less CPU.
- 7f72671: The pointer being Chromium's while its theme loads, as on every start, is a debug line instead of three errors. A missing theme, or one lacking a cursor, is still an error.
- e7a6ae6: `domicile load-shell` serves a prebuilt JavaScript shell as it is even when its text reads like an import, such as `"Turn on notifications from 'fixture'"`. It now parses the module and reads only its real imports.
- e084c4d: `~/.config/autostart` entries start again with a Domicile session. The session target and the autostart target formed an ordering cycle, which systemd broke by skipping every autostart entry, the keyring's among them.
- 70c8440: A window holding a shortcuts inhibitor, such as a VM or a remote desktop viewer, now gets the three- and four-finger swipes and holds the shell binds, as it already gets the shell's key chords.
- 4d223de: Each app's scope is `PartOf=graphical-session.target`, so a desk's apps, and daemons they started, stop when its session ends.
- 7d9d62f: An app at a fractional scale, such as 1.5 or 1.2, no longer redraws its whole window on screen for every frame. Only the part that changed is redrawn. A DisplayLink dock compresses much less, which saves CPU and battery.
- 85bdbf2: Sleeping, waking or unplugging the monitor the shell runs on no longer restarts the shell.
- 5a70826: A video entering picture-in-picture grows out of its page again, the close button shrinks it back too, and neither way flashes. `<app picture-in-picture>` fires `PICTURE_IN_PICTURE_SHOWN_EVENT` once it draws the video.
- 044a046: `domicile mcp` tells agents to read windows through the accessibility tools and screenshot only what a tree can't show.
- a575c6d: Sleeping or waking one monitor no longer flashes the others.
- f0352b4: A window's buffer its app destroys is dropped only once the GPU has finished reading it. A window that resized and then sat still, such as GIMP or LibreOffice beside a browser window, no longer stays blank white.
- 633cf63: Electron apps log under their entry's name instead of `domicile`, and `electron-host` gives its own lines their priority: an Electron API Domicile lacks is a warning, one Electron lacks on Linux is a debug line. `domicile` run by a binding logs as `domicile-cli`, and the screen recorder's encoder is a debug line instead of an error.
- 7d558a7: PDFs no longer lose thin strokes in their text on a monitor at a lower scale than the desktop's highest, as on a docked laptop.
- d91a8a6: Menus from native apps now enter only the displays their window is on and draw at that display's scale, rather than at the densest scale on every display. They follow their window when it moves to another display.
- 5bd60a5: The engine keeps one spare renderer process at rest instead of two, so an idle desktop uses about 35 MiB less memory.
- 18484f4: A tray icon whose app was too busy to answer within 3 seconds, as apps starting at login can be, now appears once the app answers, instead of staying hidden until the app changes its icon.
- 01f4ed1: Pages drag text, images and links on the desk. The DRM and headless desks had no drag handler, so every drag ended before it started.
- e4a99c9: On a terminal, `domicile` starts with its version, a row per choice (the shell as asked for, paths under `~`, and the control socket), then ticks each part as it comes up.
- 5a896a8: Print takes a screenshot while the launcher is open. A shell screenshot asked for while the shell's screenshot dialog is up answers as that dialog does, instead of showing a second dialog once it closes.
- 2f0afb2: Electron apps' pages get Electron's user agent (`Name/1.2.3 Chrome/… Electron/…`), and `app.userAgentFallback` and `session.getUserAgent()` give it, so apps such as Claude tell they run in Electron. A page's `dom-ready` comes at its DOMContentLoaded.
- 00aa5ba: `domicile set-log-level <level> [<subsystem>...]` turns the logs up or down while the desktop runs, in the compositor and every engine process, until it restarts. `--reset` goes back to the starting levels.
- 83253e1: The engine is built on Chromium 160.0.8179.0.
- 13851e8: Animations no longer stutter on a monitor running adaptive sync. The engine used to treat each page flip on such a monitor as a vsync and push the next frame back by the time the last one took to draw.
- c7c7f0b: The engine logs an error saying what a page's compositor thread did when it goes 2 seconds without sending a frame at its new size.
- 4fc31d6: Electron apps can edit and search their pages. `webContents.undo`, `redo`, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`, `unselect`, `centerSelection`, `replace` and `replaceMisspelling` now work, and so do the Edit menu's roles, which used to fail when clicked. `webContents.findInPage` searches the page and answers with `found-in-page`, as in Electron, and `stopFindInPage` ends the search.
- bbb7bfe: A window no longer freezes at its old size after it moves or resizes on a desk with monitors of different densities.
- c13eedc: Agents read and drive the shell's own bars, panels and dialogs as text: `domicile devtools shell`, and the MCP browser tools' window `shell`.
- 60c7f6e: `domicile mcp`'s browser and app acts answer what they changed in the window, so an agent needn't read it again.
- dbb98b6: On a console, the pointer is drawn for the display the desk's host is on once the displays settle after a change, such as an undock. A hotplug could leave it drawn for a display that was gone, at scale 1. The journal now says which display the pointer is drawn for, when the theme loads, when a cursor is Chromium's own, and when a cursor change reaches no window.
- 5bba752: Correct why the launcher catches `SIGHUP`: every logout sends it, not only a tty hangup.
- 94e5909: Settings reads every key the compositor reads, such as `input.mouse`, `input.touchpad` and `terminal`, instead of refusing the config. Its schema is now `@domicile-desktop/sdk/config-schema`, a Zod schema generated from the compositor's config with its defaults filled in.
- ffe3faa: The desk's certificate request through the relay names only the desk's address. It had carried rcgen's default subject, "rcgen self signed cert", which Let's Encrypt refuses, so Connect from the web never got ready. A failed request now tries again after 2 minutes, doubling up to an hour, and **Try again** in Settings › Agents tries at once.
- 9a3e343: An extension's own page, such as 1Password's setup page, opens in the browser profile that asked for it instead of the default profile, where the extension may be switched off and its page loads blank.
- fa18894: The engine's log for a page that draws nothing at its new size names the page (renderer pid and URL), counts the frames the display dropped without drawing, and says when the page last showed a frame.
- 49e9059: On a virtual GPU (vmwgfx, virtio-gpu, qxl), the pointer's tip is drawn where clicks land: the DRM cursor carries its hotspot.
- c8a3c98: The popup saying an Electron app runs on its own Electron names the app, not the path it was started from.
- 4b439f6: While an agent is in, the desk turns on AT-SPI's `IsEnabled`, so Qt, Firefox and similar apps expose their accessibility trees to it.
- 154880f: The popup saying an Electron app runs on its own Electron is drawn with the app's icon.
- 0bf960f: A night light or gamma change now shows on a monitor at once, even when nothing on it is redrawing.
- d12fea0: `domicile mcp --http` treats every session of a chat that names itself in a tool call's `_meta["openai/session"]` as one agent, so ChatGPT asks once per chat and shows one pill instead of one per tool call.
- 0366f61: Sharing a screen or window in Google Meet shows the picker once. Meet restarts its capture as it starts, which used up the pick's one-time restore token; the restart now restores the same pick.
- e6e4c44: A window shown again after another workspace or tab draws from the tiles its page kept, instead of rastering the whole page in the middle of the slide.
- 7d6b0e0: Slack on the engine signs in again: a sandboxed Electron preload's `process` is an EventEmitter that says `loaded`, `document-start` and `document-end`, as Electron's does. Slack's preload threw without it and never exposed its `desktop` bridge.
- 734b506: `domicile open --electron` gives the app what its wrapper scripts set, such as a preloaded library, programs on `PATH` and extra flags, so an app wrapped by its package (as nixpkgs wraps Element and Claude) runs on the engine as it would on its own Electron.
- bf53631: The engine logs an error when a page goes 2 seconds without drawing at its new size after a resize, which leaves it frozen at the old size.
- 5900516: `domicile mcp --relay` dials the relay again after the computer moves to another network. The kernel kept probing the connection made on the old network for good, so the desk never heard it was gone and agents on the web got "Bad gateway" until it restarted.
- 25a7b55: Zooming a PDF zooms the document once: desk tabs take Chrome's manual, per-tab and disabled zoom modes from `chrome.tabs.setZoomSettings`.
- a575c6d: Sleeping or waking the monitor that hosts the desktop (usually the laptop panel) no longer shifts the picture on the other monitors for a moment.
- d6373e3: A shell's console messages keep their severity in the desktop's logs, so its errors show by default and `console.debug` shows at `domicile set-log-level debug shell`. `logger(subsystem)` from `@domicile-desktop/sdk/logger` names the part of the shell that said each line, filed as `DOMICILE_SUBSYSTEM` in the journal.
- 6642166: A desktop running a checked engine, as `main` does between an engine change and the next nightly build, says so in a notification and points you to stable or a release.
- ed5a83e: Fix memory filling up until the desktop crashes when every app draws with the GPU. The compositor now lets go of a window's old graphics buffers once the app frees them.
- 6db9de5: A page's link for an app, such as Slack's `slack:` sign-in link, opens the app the desktop's prompt named. The engine's `xdg-open` is `domicile open`, as every app's is, and `domicile open` has the compositor start the app it picks, as the launcher does, so it gets the desktop's environment whoever asked.
- dbc8eb2: The pointer follows a display's new scale or turn. After undocking, the laptop panel is scaled only after it is added, and the pointer stayed at 1x until a window opened.
- fdee121: Fix the lock screen not getting typed keys when a window had the keyboard as the desk locked. Locking now gives the keyboard to the page, and the engine keeps every key on the page while locked, logging an error if a window still has the keyboard.
- 0a56393: In the journal, each part's logs carry their priority and a name: `domicile-compositor`, `domicile-engine`, `domicile-shell`.
- fe6ce49: `domicile trace <file>` records the engine's trace events (frame production in the shell and pages, the display compositor, GPU and page flips) to a Perfetto trace. The engine reports to a socket beside the control socket, where `domicile trace` runs Perfetto's service while it records.
- ee4a5bd: The engine's log for a page that sends no frame at its new size also says, in full, what the page's tiles are waiting on.
- a1d96a3: A page whose renderer answers the browser with a reply to the wrong request crashes and offers a reload, instead of hanging. The engine logs each message mojo refuses, and why.
- 5c66a46: An Electron app's pages in its own scheme reach the LAN and VPNs with no Local Network Access prompt, so Element reaches a homeserver behind WireGuard.
- 51b4aef: The engine's log for a page that never acks a resize also names the page: its renderer's process, what kind of widget it is, and its URL.
- 2ce6387: The engine logs an error when a page stops being asked to draw, which leaves it frozen, and when a page drops a run of draw requests as out of date.
- 3927dd2: The engine shuts down cleanly when the desktop ends. A second SIGTERM, which a session end always sends, no longer kills it part way through saving its profile (patch 0259), and the launcher signals the browser alone and waits up to 15 s for it instead of 3 s. Before, every start counted the last session as a crash.
- 789a740: Extensions the config installs from the Web Store stay on across restarts. The engine grants their permissions, which Chrome otherwise found missing at each start and switched them off for. Switching an extension on grants its permissions too, and an extension the config names but never recorded, such as after a crash, uninstalls when the config drops it.
- 2d0971d: The desktop's logs are quiet by default again. Turning up one subsystem shows only that subsystem's engine lines, not every engine file's. Pages' and extensions' consoles appear only when everything is turned up. Apps the desktop starts log under their own names at `info` instead of as the compositor's errors, and the web-agent relay under `domicile-relay`. The engine no longer turns on a V8 flag its V8 rejects, which wrote "unrecognized flag" hundreds of times a boot. A broken unpacked extension is reported once, not once per profile and reload. Chromium's fallback art for the hidden pointer is no longer reported as an error.
- 7f72671: A page that has never drawn, such as a new page before its first navigation or an empty cross-site frame, no longer logs as a stalled page at ERROR. A page that drew and then stops still does.
- 7dc15f7: Electron apps start again on Domicile's engine. Slack died at start because the engine's Electron had no `app.requestSingleInstanceLock`; it has that now, and every other Electron API an app can call is there too. One the engine can't do yet hands the app to its own Electron with a notification saying so, instead of crashing it.
  
  An app whose wrapper script was just written no longer fails to open with "Text file busy" on Domicile's engine.
  
  Element and Claude run on the engine from their first start, since the engine now registers their own schemes before they ask.
- 99742b4: The engine lists cameras and microphones on the first ask instead of at startup, and answers that ask once they are listed. Chrome's dictation, which listed microphones as each tab opened, stays off. An idle desktop no longer runs Chromium's audio service (~35 MiB).
- 3f96dbf: `domicile set-log-level info` now tells what changed: windows opening and closing, the screens going dark and coming back, the desktop locking and unlocking, and screen casts starting and ending. `trace input` logs every input event, saying where it landed but never which key or what was typed.
- 7df5d66: Electron apps' clipboard and link handlers work without `wl-clipboard` or `xdg-utils` installed: Nix puts both on `electron-host`'s `PATH`, and distribution packages recommend them.
- 5ba3eae: - NixOS: the system build fails, saying how to fix it, when Domicile cannot load the system's graphics driver (a driver from a newer nixpkgs). Fix: `inputs.domicile.inputs.nixpkgs.follows = "nixpkgs";`.
  - The compositor reports a failed EGL renderer as an error, with an urgent "Graphics aren't working" notification; each render node libgbm refuses is logged with its reason.
- 70792da: Electron apps start on the engine more reliably:
  
  - Apps started at login wait up to a minute for the engine instead of failing at once.
  - An app whose package removed some of its unpacked files (nixpkgs' ChatGPT) starts.
  - safeStorage picks its backend the way Chromium does, from `--password-store` and the desktop, so Element no longer migrates its store and relaunches forever. `app.commandLine` now answers the switches the app was started with.
  - `session.allowNTLMCredentialsForDomains` is accepted, and Slack's `slack-webapp-dev` and ChatGPT's `codex-sandbox` schemes register from the engine's first start, so neither falls back on its first run.
- f7fae92: The engine logs an error saying what holds a page that goes 2 seconds without drawing at its new size.
- fa96f94: An Electron app hears its pages' state from the engine: their history, whether they're loading, which has the keyboard focus, their renderer's pid and whether it crashed. `webContents.navigationHistory` (and `canGoBack`, `goBack` and the rest) now walk the page's real history, `BrowserWindow.getFocusedWindow` and `isFocused` follow the page's focus, and `isLoading`, `isCrashed` and `getOSProcessId` answer truly, with Electron's `did-start-loading`, `did-stop-loading`, `focus`, `blur` and `render-process-gone` events.
- 9305fc5: A window's new buffer reaches the desktop only once the GPU has made its image. A window that resized and then sat still, such as Blender, no longer stays blank.
- bce2815: Pinching a PDF no longer magnifies its rendered image, which pixelated its text. Only the PDF viewer zooms it.
- 0f25a37: `domicile-miracast` runs as the user unit `domicile-miracast.service`, part of `graphical-session.target`, so it ends with the desk.
- 217a403: A `<webview>`'s download asks its element where to go before Chrome's one-picker-at-a-time queue, so a picker that is never answered no longer stops every later download in the profile from asking.
- 07e9ad2: Clicking an app's tray icon, or an entry of its tray menu such as "Show Slack", now shows its window even when it is in a hidden tab, on another monitor or on another workspace.
- bc3a82e: A `<webview>` hidden with `display: none` keeps its page's compositor viewport, so the tiles it kept are still there when it is shown again. Switching to a workspace with a browser window no longer rasters its whole page in the middle of the slide.
- 78e8b7f: A screenshot or screen cast the engine can't capture now fails at once with the cause, instead of timing out. Nested in a Wayland session whose GPU can't make dmabufs, captures now come in shared memory, so `domicile screenshot` works there.
- 501a4b1: The flake serves Domicile from a binary cache at `https://packages.domicile-desktop.com/nix`, filled for each commit `stable` moves to, so `nix run` and configs pinned to `stable` download Domicile instead of building it.
- 4be0576: Firefox takes the mouse. A subsurface whose input region leaves the pointer out, as Firefox's content surface's does, passes it to its window.
- e04bf9d: - The engine's GPU process loads Mesa's GBM backends and DRI drivers before its sandbox, so a card handed over later finds the libraries they link. On NixOS, LLVM was refused ("libLLVM.so.21.1: Permission denied") and the card showed only software output.
  - A driver that does not load logs the loader's reason as an error.
- 52a2a9c: Opening, closing and settling a browser window no longer rasters its page again every frame, which made these animations janky on heavy pages. A fading window also reuses its page's last drawing instead of redrawing it each frame.
- e03459a: ChatGPT opens again. It refuses to start on anything but OpenAI's own Electron fork, so `electron-host` hands it back to its own Electron before its main runs, with a notification saying so.
- dec9fc2: A page's `mailto:` link reaches the shell that claims `mailto:`, such as manganese's inbox picker. Chromium opens these links with `xdg-email`, and a desktop's `xdg-email` is `domicile-xdg-email`, which runs `domicile open` on the link its arguments make.
- 7e80ff9: A call to a page's widget sent just before the widget closes reaches it before the close, instead of being dropped with "came after the interface disconnected" in the log.
- Updated dependencies [6f4cabd]
- Updated dependencies [b7d85c0]
- Updated dependencies [d57e6f6]
- Updated dependencies [d3978bb]
- Updated dependencies [0ee4ce8]
- Updated dependencies [9f22031]
- Updated dependencies [6f3ec06]
- Updated dependencies [0492adf]
- Updated dependencies [996cc29]
- Updated dependencies [60e7c7e]
- Updated dependencies [cd75f9a]
- Updated dependencies [5090cbd]
- Updated dependencies [c454256]
- Updated dependencies [09a3ad4]
- Updated dependencies [24b88fb]
- Updated dependencies [86c57d9]
- Updated dependencies [52e71af]
- Updated dependencies [5a70826]
- Updated dependencies [57f6fe2]
- Updated dependencies [5c11ddc]
- Updated dependencies [befeb71]
- Updated dependencies [4a4f057]
- Updated dependencies [5b3650f]
- Updated dependencies [4b7a878]
- Updated dependencies [1036a91]
- Updated dependencies [1cbbfb5]
- Updated dependencies [f0a0a61]
- Updated dependencies [d1b3ab9]
- Updated dependencies [69247ca]
- Updated dependencies [eaa92c7]
- Updated dependencies [7921005]
- Updated dependencies [94e5909]
- Updated dependencies [bc8db8f]
- Updated dependencies [e821d1f]
- Updated dependencies [ffe3faa]
- Updated dependencies [46d7737]
- Updated dependencies [e3d8320]
- Updated dependencies [8ff882e]
- Updated dependencies [876c824]
- Updated dependencies [14704ae]
- Updated dependencies [3600d3b]
- Updated dependencies [9c805c4]
- Updated dependencies [9ea68bf]
- Updated dependencies [a2cab16]
- Updated dependencies [da632d6]
- Updated dependencies [539ce11]
- Updated dependencies [e4f3394]
- Updated dependencies [e7b707c]
- Updated dependencies [756c1bd]
- Updated dependencies [73dc50f]
- Updated dependencies [133ce8a]
- Updated dependencies [e458dd7]
- Updated dependencies [b95da52]
- Updated dependencies [1209f22]
- Updated dependencies [53ff70a]
- Updated dependencies [a5ade39]
- Updated dependencies [5315b06]
- Updated dependencies [f268f2d]
- Updated dependencies [4b89923]
- Updated dependencies [04baee9]
- Updated dependencies [0c5f1ce]
  - @domicile-desktop/app-settings@0.2.0
  - @domicile-desktop/manganese@1.3.0
  - @domicile-desktop/shell-simple@0.0.5
  - @domicile-desktop/app-history@0.0.5
  - @domicile-desktop/shell-splash@0.0.5
  - @domicile-desktop/builder@0.2.0

## 1.2.0

### Minor Changes

- c664ef4: Shells bind touchscreen swipes in from a screen's edge, written `edge:left`, `edge:right`, `edge:top`, `edge:bottom` or `edge`, beside their keys and touchpad gestures. A finger landing at an edge the shell binds waits until it is clearly coming in; a scroll or tap there still reaches the app underneath. Manganese swipes between a monitor's workspaces from its side edges.
- 1af639c: File access, client certificate, Bluetooth pairing and extension permission prompts now ask in the shell, over the page, instead of in Chrome's unstyled dialogs drawn over the desktop. Sites in browser windows can now be allowed to edit files they open. `<webview>` fires `domicile-prompt`.
- eba7d0d: Night-light apps such as gammastep and wl-gammarelay-rs work: Domicile speaks `wlr-gamma-control`, so each can warm, dim or curve each monitor on its own. While an app holds a monitor, the shell's night light leaves it alone, and takes it back when the app lets go. `displays.setColorTemperature(kelvin, display)` warms one monitor by name.
- af7415e: Hide the pointer while typing and after a pause in pointer input, with `theme.cursor_hide_when_typing` and `theme.cursor_hide_after_ms`. The next pointer move, click, scroll or touchpad gesture shows it again.
- bb1e4cb: A page's tooltips, the "send the form again?" question on reload and the "page isn't responding" question are now the shell's, instead of Chrome's. `<webview>` reports its tooltip as `tooltip` with `domicile-tooltip-change`, and `domicile-prompt` gains the `resend-form` and `unresponsive` kinds. Reloading a page a form posted to used to do nothing; it now asks.
- 8eaae53: Configure touchpad tapping, clicking, scrolling and typing suppression, and mouse acceleration and scrolling, through the desktop config. Choose native libinput typing suppression or configurable pauses. Apply settings on reload and device reconnection.
- 63db244: Chrome never draws a dialog over the desktop. Any Chrome dialog the shell has no answer for is canceled and logged, so a gap fails closed. Payment Request and FedCM ("Sign in with Google"'s account chooser) are off, so sites use their own checkout and sign-in pages, and picture-in-picture video is off since Chrome floats it in a window of its own. Document picture-in-picture still opens, as a shell window.
- d3bf90b: Touchpad swipes and holds of three or more fingers that the shell doesn't bind now reach the app under the pointer, so apps that use them work: in Manganese, which binds three- and four-finger swipes, holds and five-finger swipes go to the app.
- f592184: Shells bind touchpad gestures of three fingers or more beside their keys, in sway's `bindgesture` grammar such as `swipe:3:left`, and in the same modes. `DomicileHost.grabGesture()` and the `gesture` event carry every phase; `domicile.gestures` wraps them. Manganese swipes four fingers between a monitor's workspaces, and gains `workspace next_on_output` and `prev_on_output`.
- 18413ff: A link for an app, such as Zoom or Slack, asks "Open Zoom?" over its page in the shell's style, naming the app and showing its icon, instead of Chrome's unstyled "Open xdg-open?" dialog. A secure site can be let open these links without asking. Shells get `domicile-external-app` on `<webview>`.
- 69fe0d8: A page that can't load, has a certificate problem, is flagged as unsafe or crashes now shows a shell page with Try again, Go back or Continue anyway, instead of Chrome's own error and warning pages. `<webview>` reports why as `pageFailure` with `domicile-page-failure-change`, and `proceedPastWarning()` passes a warning.
- a354497: A site or proxy that asks for a username and password now asks in the shell, over the page, instead of in Chrome's unstyled dialog drawn over the desktop. `<webview>` fires `domicile-sign-in`.
- 71a8c7b: Keep a web page gliding after a two-finger flick, as native apps already do. The glide follows your fingers' own speed, so scroll acceleration doesn't make it overshoot. Resting or moving your fingers on the touchpad stops it.
- 9246b97: A page's color, date and time pickers and a text box's suggestion list are now drawn by the shell, hung from the control, instead of by Chrome. `<webview>` fires `domicile-picker` with the control's kind, value, suggestions and box, answered with `choose()` or `cancel()`.
- 411a31d: A finger on a native window reaches it as a touchscreen touch, so apps scroll, select and pinch as they do on any Wayland desktop. An app that reads no touch gets the first finger as the pointer and its left button. A finger on a window no longer pans or zooms the shell around it. A touchscreen with no `input.pointers` entry now covers the only display when there is one, so a laptop's own touchscreen works with no config.
- b8ccdba: Forward touchpad pinch gestures to native Wayland clients, including Google Chrome page zoom. Preserve the platform gesture phases, absolute scale, rotation and cancellation through the engine and `<app>`.

### Patch Changes

- 952d3ee: Fix web pages not gliding after a two-finger flick, and slow two-finger scrolls going missing soon after a flick.
- 7e3f354: Shells can use WebAssembly, so a shell can be written in Rust or another language that compiles to wasm. `examples/dioxus-shell` is one, in Dioxus.
- bc4a277: A closing window animates out with its contents again, instead of its picture vanishing at once. The compositor keeps a closed app window's surface, and the engine a closed browser window's page (muted), for a second while the shell animates it out.
- 2ec7ecc: A page's tooltips now wait Chrome's delay before showing, and a tooltip in a frame from another site (Bitwarden's autofill menu, a Cloudflare challenge) shows at the pointer instead of far from it.
- 9a150aa: Brings back the browser engine's speedups that the previous release turned off by mistake, while keeping workspace slides from redrawing the desktop on every frame.
- 9f763cf: Pinch works as on a Mac. A two-finger pinch magnifies the browser page under the pointer without reflowing it, and a native app gets its own pinch. Meta+pinch or Meta+two-finger scroll magnifies the whole screen around the pointer. A plain pinch over the shell does nothing.
- 8c2c52e: Fix WebGPU getting no adapter on NixOS: the Vulkan loader beside the engine is now nixpkgs' NixOS-aware one.
- 56275da: A touchpad pinch works with several monitors. With the pointer on any monitor but the one hosting the desk, a pinch did nothing, with or without Meta.
- 16f8ff4: App windows no longer flash white while they resize. An app may throw away a frame the screen is still showing, such as one drawn at its old size. The engine now keeps that frame until the screen is done with it, instead of drawing a blank in its place.
- a542f66: On a console, the pointer keeps the desk's cursor theme when it comes back from hiding over a window that names no cursor, instead of switching to Chromium's own arrow.
- 9554847: A pointer hidden by typing stays hidden when the shell moves it to follow keyboard focus, such as on switching windows, opening one or closing the focused one. Only a hand on the mouse or touchpad shows it again.
- a006e48: The GPU process no longer runs without its seccomp filter, at random, when a thread it joined just before its sandbox started is still listed in `/proc`.
- d69b2f4: A page's notification names its browser window, so only the Gmail inbox's own window has its duplicate notifications cleared; Gmail in another window notifies again.
- f14ec1c: A tty desktop whose graphics card cannot draw, even on the CPU, no longer restarts its GPU process forever on a black screen. Chromium's GPU crash limit is back on, and when no GPU mode works `domicile` stops with "renderer unavailable" and exit code 69.
- d83d2d9: Closing kitty, or another app that frees its last frame before it closes, animates with its contents again, in a tab group too. The compositor keeps a frame still on screen until it is replaced or the window's close animation ends.
- c7973a8: A pinch on a window keeps going when a pinch begins for a window the pointer is not on, instead of ending.
- 7166899: Show GPU-drawn apps on NVIDIA drivers whose EGL can't list devices, by opening the GPU through GBM instead
- 27e6e33: A machine whose EGL lists no devices and whose render nodes have no GBM, such as a VM without 3D, renders in software instead of serving `wl_shm` clients only.
- 4b5b6f7: On a tty, a website's own pointer image (such as the hand over a Google map) turns with a rotated monitor instead of showing on its side.
- e8696d9: `domicile load-shell` goes back to the shell you had when the new one fails to run, and prints why.
- cdb3534: Stop touchpad flicks in native apps from scrolling far past where you aimed. Native apps get libinput's scroll distance and run their own momentum; scroll acceleration now applies to pages only.
- Updated dependencies [76c4390]
- Updated dependencies [c664ef4]
- Updated dependencies [7371c33]
- Updated dependencies [bc45b4c]
- Updated dependencies [b3e7457]
- Updated dependencies [62ccd23]
- Updated dependencies [af7415e]
- Updated dependencies [d69b2f4]
- Updated dependencies [174918e]
- Updated dependencies [e2418db]
- Updated dependencies [f592184]
- Updated dependencies [50318b4]
- Updated dependencies [56adc6f]
  - @domicile-desktop/manganese@1.2.0
  - @domicile-desktop/app-settings@0.1.2
  - @domicile-desktop/app-history@0.0.4
  - @domicile-desktop/builder@0.1.2
  - @domicile-desktop/shell-simple@0.0.4
  - @domicile-desktop/shell-splash@0.0.4

## 1.1.2

### Patch Changes

- 0d1d2dd: On a tty, a VMware guest with 3D on composites on the GPU instead of the CPU.

## 1.1.1

### Patch Changes

- 8d8417d: App windows show when the engine's GPU process falls back to software, as in some VMs: the compositor sends them in memory instead of leaving them transparent.
- c44f0f2: A desktop on a tty in VirtualBox (VMSVGA) or VMware with 3D acceleration off composites on the CPU, so app windows show instead of staying transparent.
- Updated dependencies [93e6a4b]
  - @domicile-desktop/manganese@1.1.1
  - @domicile-desktop/builder@0.1.1
  - @domicile-desktop/app-history@0.0.3
  - @domicile-desktop/app-settings@0.1.1
  - @domicile-desktop/shell-simple@0.0.3
  - @domicile-desktop/shell-splash@0.0.3

## 1.1.0

### Minor Changes

- fe90bca: App windows can belong to an app id, and a launch can reuse that app's open window instead of opening another: `domicile open --app --id <id> --reuse focus|navigate <url>`, or `browser.openApp(url, { id, reuse })`. Windows list their `appId`. `browser.countMatches(id, selector)` counts elements in a browser window's page, hidden or not.
- fff3e24: A window's screen cast carries its app's sound, and a monitor's every app's, in a PipeWire audio node beside the video.
- 64ffcb7: `domicile theme [light|dark|toggle]` switches the desktop's theme from a terminal, or prints it. It works with any shell and needs no pointer.
- eca2588: Clipboard history rows show a thumbnail of a copied image: `DomicileClipboardEntry.thumbnail` is a small PNG `data:` URL (empty for none; the SDK gives `undefined`), and `RowTile` takes a `picture` to draw in place of its glyph.
- f15f43a: The clipboard history is wider and shows more of each copy: up to four lines of text with its line breaks, and a larger image preview beside its size. What is on your clipboard gets its own group above what was copied before. The compositor previews 480 characters and makes thumbnails up to 256 px. `RowTile` drops its `picture` prop.
- 0ba4ab7: `domicile monitor <name> <W>x<H>[@Hz]` adds a virtual monitor until stdin ends, resizing it to each size read.
- e455955: `domicile open <file|folder|url>` opens anything: a web link in a browser window, anything else with its type's default from `mimeapps.list`, supertypes counted (a `text/plain` default opens Markdown and source code). `domicile open --app <url|module>` opens a site or app module as an app. Domicile's `xdg-open` and the launcher's Enter run it, so apps, terminals and the launcher agree. `open-url`, `open-app` and `run-app` are gone: use `open` and `open --app`.
- f3156a1: Emulated input (remote desktop, input sharing) on a desktop on a TTY now reaches the shell and the lock screen, as on a headless desktop. A headless desktop's monitors draw at their own scale, and emulated pointers land where they point on a scaled or rotated monitor.
- 56e1c22: File picker polish:
  
  - New folder button, and a Hidden files toggle (Ctrl+H).
  - The listing updates when the folder changes.
  - The save name box no longer walks a `/`.
  - No key help in the sidebar; full-size sidebar buttons.
  - Portal labels drop GTK's `_` access key marks ("_Save" shows as "Save").
  - `System.createDir` (`create_dir`) makes a directory. `FileRequest.list` is replaced by `FileRequest.folders` (`systemFolders` in `@domicile-desktop/component-library/folders`).
- e42226f: `theme.force_dark` names sites, such as `mail.google.com`, that the browser draws dark with Chromium's automatic dark mode while the theme is dark, for sites with no dark theme of their own.
- 5955f66: On a headless desktop, input from a remote desktop app (EIS) reaches the shell and its lock screen, so the desktop can be driven and unlocked with no keyboard or mouse attached. Screen casts of a headless desktop now show the pointer.
- 401b0b4: `OZONE=headless` runs a full desktop with no display device or seat, such as on WSL2. Its monitors are virtual ones the shell adds, and screen casts show each one. Apps draw in shared memory, GL apps included.
- a999398: The keep awake panel draws each app's own icon. `idleHolds` now hears app ids, for the shell to name and draw with `useApps`, instead of names.
- 9d4a876: The keep awake pill names the website a browser window keeps the screens on for ("Kept awake by youtube.com"), with its icon, instead of the engine. `<webview>` gains `wakeLock` and `domicile-wake-lock-change`, and the compositor lists the engine's own hold as `domicile-browser`.
- 44d0983: Switch keyboard layouts at runtime. `input.keyboard.keymaps` lists named keymaps; the first is the one the desktop starts on. The `keymap next` and `keymap <name>` commands switch every keyboard and show a toast, and the new `Keymap` bar item, in the default bar left of the theme toggle and on the lock screen, shows and switches it. The item's list and the toast show xkb's name for each layout. A switch lasts until the desktop restarts. The shell option `keymap.hideDefault` hides the item on the first keymap, and the Settings app's Keyboard page edits the list.
  
  The component library adds `ChoiceRow` (`RadioRow`, `CheckboxRow` and `ChoiceList`), the screenshot picker's rows as a component, and `ChoiceToast` takes a `detail` line.
- b2c6fd5: Cast the desktop to Miracast TVs (Fire TV, Roku, Samsung, LG, Windows wireless displays) over Wi-Fi Direct or the LAN. The new `domicile-miracast` service runs each cast; `miracastCast(domicile)` in `@domicile-desktop/sdk/miracast` is its backend, and the `Cast` bar item lists its TVs.
- 3da1465: `domicile monitor` takes an optional scale after the size, like `domicile monitor TV 3840x2160 2`, and so does each resize line on stdin.
- 93f015d: A page can ask for window management, local fonts, idle detection and automatic downloads. The shell asks the user, and Settings and the site panel show each.
- fccc784: Automatic brightness and a night light, as on macOS. The backlight follows the room's light from iio-sensor-proxy and learns from the levels the user sets. The night light warms every monitor from sunset to sunrise in the time zone's city, or on custom hours, with a switch in the brightness popover. Both are on by default and set in the Settings app's Shell page or under `shell_options`. Shells set the color temperature with `domicile.displays.setColorTemperature(kelvin)`.
- 2bf4b18: A desktop whose machine lacks the lock's PAM service, such as a `nix run` trial, does not lock: locked, nothing could unlock it. An urgent notification, "This screen won't lock", says so at startup, and the log names the file to add. Adding it turns the lock on with no restart. The Manganese page notes this under its trial command.
- cd52ce3: The launcher's "Open with…" now lists first the app Enter opens the file with, so the two always agree. `domicile open --which <file|url>` prints the app `domicile open` would run, and the desktop puts its own `domicile` first on its apps' `PATH`.
- bbf849b: A client can ask to be laid out at a named place in the shell's page (`domicile_anchor_v1`). Shells read it as `DomicileWindow.anchor`.
- 93f015d: A page's `getDisplayMedia()` reports the surface picked (window, browser window or monitor) and, when it asks for audio, gets the source's sound. A browser window is captured as a tab, with its sound, `cropTo()` and capture handle.
- 3bb9bd5: A download's file picker starts in the download folder (`XDG_DOWNLOAD_DIR`). The file chooser event has `currentFolder`.
- 52a1d65: The screenshot and screen share pickers draw a window that is not on screen, such as a tab behind another, in place of the desk when it is picked. `System.previewWindow` draws one, through the compositor's new `preview_window` system call.
- 3e5b976: The print dialog labels every option and saves to PDF: pick "Save to PDF" as the destination, then where to save it.
- 1c7e183: The desktop stays smooth while the machine is busy without joining the `domicile` group: the engine asks rtkit to raise its drawing threads when the limits refuse. The NixOS module enables rtkit, and the packages recommend it. The group is optional and gives the most reliable result.
- 2430e48: Screen recording: `domicile screen-record` and the Screen Record launcher entry pick a screen, window or region and record it with its sound to `~/Videos/Screen recordings/`, with a floating toolbar (pause, resume, stop, discard) left out of the recording.
- 9fd298a: The screen share picker offers browser windows, streaming the page alone, and previews each source on the desk. The screenshot picker shows the same preview tiles.
- 33444d9: Settings has a Site data page: each site that stores cookies or other data, its size, and a button that removes it.
- 912dcac: A desktop on a tty lights a screen with no 3D (2D virtio-gpu, Hyper-V, simpledrm, vkms): the engine composites on the CPU and windows reach it in shared memory. `DOMICILE_SOFTWARE_COMPOSITING=yes` or `no` overrides the guess.
- 6c3db42: A virtual monitor can be resized in place with `resize`, keeping its output, windows and casts.
- 9c89f16: A virtual monitor can have a scale of its own, such as 1.5, when added or resized (`addVirtualMonitor` and `resize` take `scale`).
- ca86667: A shell can add a monitor with no connector, which the desk extends onto and only a capture shows, with `system(domicile).addVirtualMonitor()`. Casting to a TV extends the desk this way.
- f50a783: Wayland capture tools (`grim`, `wf-recorder`, OBS's wlroots capture) copy from a running cast of the monitor, frame after frame, into shm or dmabuf buffers, and get only frames with damage they have not seen.
- cd5614b: Wayland capture tools can list windows (`ext-foreign-toplevel-list-v1`) and capture one alone, and follow the pointer with a cursor session.
- ee1cc17: `<webview partition="persist:name">` gives a page storage of its own, kept on disk; any other name keeps it in memory. `openBrowserWindow(url, partition)` opens a window in one, listed with its `partition`. A page's own navigation fires a cancelable `domicile-will-navigate` first.

### Patch Changes

- 58dac0a: An app module's system calls survive a compositor restart: the engine ends them with `compositor_gone` and dials the new compositor, so the SDK's watches and D-Bus matches listen again.
- dba9bdb: An idle blank turns the monitors off. The engine left every connector it was told to turn off out of the modeset, so the screens kept showing the desktop. A profile that turns a panel off turns it off too.
- c49b1d6: The screens stay off once they blank: a pointer that did not move no longer wakes them.
- 866cf8e: Video calls and films in a browser window keep the screens on. The compositor serves `org.freedesktop.ScreenSaver`, so a screen wake lock (Google Meet, YouTube) holds the desktop awake while its window is shown.
- 1dbe9e4: A browser window screen cast draws the pointer over the page.
- af3a4e8: Fix black recordings and casts of a browser window: its stream now starts at the page's size instead of one pixel.
- 8494716: On a tty, the engine takes each graphics card from logind, which hands DRM master over on a console switch, and keeps reading the keyboard and mouse while logind answers.
- 0af60e0: A screen cast draws the pointer at the screen's scale, so it is a normal-size arrow on a HiDPI screen rather than a speck.
- 623860a: While a TV is cast to, the desk holds off idle blanking and holds notification banners, which the TV could show. `inhibitIdle` takes the reason the portal is told.
- 5fc22c6: Sharing part of a hidden window from a page no longer reopens the picker: the restore token keeps the part while the compositor runs.
- 4759ab2: A fractionally scaled window's screen cast draws the pointer where it is, at its size.
- 47716fe: Screen casts drawn on the GPU show the pointer wherever it is, not only near the top left corner.
- dc2e78f: Screen casts draw the pointer that is on screen, such as a hand over a link, instead of a fixed arrow.
- 952fc0a: A TV the desktop extends onto goes above the monitors, centered, so the pointer reaches it by going up.
- 4594119: The shell no longer crashes when an animation ends just as a page with text stops being opaque: the engine waits for the frame it is about to show before redrawing that text.
- 1161efd: `domicile --help` (or `-h`, `help`, or `<verb> --help`) lists every command.
- 22844b3: Docs audit: Wayland-only app support and the apps we check, the config schema served from domicile-desktop.com, locking in a `nix run` trial, portal requests a shell must answer, a complete packaging example, GPU troubleshooting for users, a NixOS flake example, differences from Chrome, and contributor-only sections labeled in the package references.
- eda45b9: A window drawing faster than the engine can show it no longer crashes the engine's GPU process: while viz is 16 frames behind, the engine holds the window's newest frame and drops the ones it replaces.
- 17064a7: A browser window whose `<webview>` moves in the shell's document shows its page again where it lands. Before, the page stayed detached and the window froze, which happened when a window crossed monitors while being resized.
- 93f015d: A browser window's `<select>` and other popups stay on the monitor they open on, rather than opening across a seam.
- ecd3fba: An extension's `action.openPopup()` opens its popup in the tray, so Phantom's tray button opens Phantom. The SDK reports the request as `extensions.on("popup")`.
- 62a671f: An extension's `sidePanel.open()` opens its side panel as a tiled window of its own, with no address bar, so Phantom, which opens in its side panel by default from 26.37, opens again. A popup an extension asks for opens under the icon that was clicked, on that monitor, not on the focused one; the tray state gains `clicked`.
- 506b12f: Apps known only by an id that no desktop entry uses, such as `com.chromium.Chromium`, are named by a matching entry or a readable form of the id ("Chromium") in portal dialogs, the sharing indicators, global shortcut conflicts and portal notifications.
- 8ffb4c5: On a device whose render node allocates no GBM buffers, such as vgem under WSL2, the compositor allocates on the device's primary node, so shared-memory windows and casts are no longer blank there.
- 73dd960: Gmail's new-mail notifications are drawn with Gmail's site icon, the one the launcher shows, instead of a letter. A notification's picture may be an image's `data:` URL.
- 6730912: A browser window hidden behind a tab can be screenshotted, previewed and shared: the engine lists it as `isCaptured` while a capture runs, and manganese keeps it laid out under the shown tab. The screenshot and share pickers keep their size when a pick shows a preview. A shared screen's cursor reaches consumers that read it as metadata, such as Chrome.
- 2a87739: The screenshot and screen cast pickers take a part of a window that is not on screen, dragged over its preview.
- 4b76732: A hidden window, on another workspace or behind a tab, no longer keeps the screens on with its idle inhibitor. It holds them again once shown, as the protocol asks.
- b16913f: Typing or pointing in a browser window or the shell keeps the desk awake, so it no longer locks under somebody typing.
- b0e0a13: The keep-awake eye names what holds the screens on as you know it (Claude, not com.anthropic.Claude), from each application's desktop entry.
- 901b871: The keystroke latency run divides by the display frame viz reports, not an assumed 60 Hz, and also reports `commit to present` from viz's presentation feedback. Its guard allows `commit to pixel` the probe's floor plus one frame, so a 120 Hz panel passes.
- fc744c5: The launcher lists matching files shallowest first, so files near home come before ones deep in a tree.
- 1fb14ba: Launcher file search lists files and folders whose name matches before those that match only in a parent folder's name, even when the parent-folder matches are shallower.
- 4ac3c0d: The launcher previews PDFs again: the PDF viewer starts in the shell instead of drawing an empty gray pane.
- b85d9bb: Name what keeps the screens on. A new `idle_holds` system call (`session.idleHolds()` in the SDK) lists the windows and applications holding idle inhibitors, and the bar's eye opens and names them. The compositor logs each change, and the input that restarts the idle clock when it was getting close to blanking or locking, naming the event and device for the browser's own input.
- 558794b: The network item stays on the bar after a lock and when the network service fails, hiding only on a machine with no network hardware. It shows a cable that iwd or wpa_supplicant cannot report, and its panel lists each wired port with its speed, addresses and gateway. `system-network` adds `interfaces`: the hardware from `/sys/class/net` and addresses from `ip`, which the compositor's wrapper now puts on `PATH`.
- 7dc458f: The night light turns off again, on schedule and from its switch.
- 508f227: A notification that comes without an icon is drawn with its app's icon, found from its `desktop-entry` hint or its app name, instead of a letter.
- 2c10391: Pressing a notification from an app that is running with no window open, such as Slack closed to its tray, starts the app again so it shows its window.
- 3a7a001: Pressing a notification raises its app's window even when the app asks with its own activation token instead of the one the press hands it, as Slack and other apps on Electron before 42 do.
- ce4b472: Site and shell notifications reach the desktop even when the compositor's notification server starts after the engine. The engine waits up to 20 seconds for it instead of falling back to Chrome's own popups.
- 61ef2b4: An application's notifications clear once you look at it: when its window gets the keyboard, or when you press any of its notifications. Slack and most Linux applications never close their own.
- e2d8a62: Sharing from Slack asks once: an app's casts started together take the one pick, instead of putting up a picker each.
- 670713c: The app chooser asks in plain words. With one application it asks "Open Claude?" beside Claude's icon ("Chromium wants to open this link in Claude."); with several, "Choose an app to open this link"; with none, "No app can open this link" and only Close. The link shows on one muted line at the bottom. `AppChooser` takes `asker`, `opened` and `address` in place of `title` and `description`.
- 3ee3ca0: PDFs, images and videos open in a browser window of the desktop by default, as links do.
- 3146073: Each package asks for the bun and Node its workspace does: `engines` is `bun >=1.4.2`, `node >=24`.
- 01c092d: A window whose page shows an `alert()`, `confirm()` or `prompt()` no longer slows a workspace switch, or a window growing or shrinking. The shell waited for the paused page to draw on every frame.
- 99ff136: Keep the default log quiet. Routine compositor lines (idle holders, display reloads, casts, thread priorities, requests refused while locked) are debug, and the launcher prints its choices and the shell build's progress only on a terminal.
- 4ad0520: Screen recordings of a screen or region are scaled down to at most 4K's pixels, so a whole desk of high-density monitors records smoothly instead of at a few frames a second.
- 8007832: Screen recordings encoded on the GPU play to the end: they use constant quality instead of a fixed bitrate the GPU padded every frame up to.
- 270cf9a: Screen recordings are encoded on the GPU (AV1 or VP9 through VA-API) when it can, so a recording near 4K keeps up instead of dropping to about 15 frames a second. Without a GPU encoder they are VP8 on the CPU, as before, with the color conversion now spread over every core.
- 54cd3a0: Screen recordings of a whole monitor or the desk no longer lose frames, which broke playback until the next key frame: a frame that repeats the last frame's timestamp is moved just after it.
- 3acb12b: After a compositor crash, the new compositor launches again the clients Domicile launched that the crash took, on the same Wayland display. Qt 6.6 and later reconnect instead.
- 209873d: A menu its app repositions moves on the page, in the same frame as its new content.
- cd794f9: A native window no longer shows zoomed in while you resize it on a scaled monitor.
- 75799a0: Dragging a window's edge no longer makes its contents jitter. While an `<app>` or `<webview>` has `resizing`, the window's latest frame shows at its own size in the top left corner until the window draws at the new size, instead of being stretched to the new size and then snapping back.
- f1bfea4: Apps such as Electron's keep up better while you drag a window's edge: a window may now have three sizes it has not drawn yet, instead of one, so an app that draws several sizes at once no longer waits for each in turn.
- 79b9aea: A copy restored from the clipboard history moves to the top of it, so the history marks it as what is on the clipboard now.
- 6f85479: Apps no longer crash when a display goes away, such as a TV the desk extended onto. The compositor withdraws a removed display's `wl_output` first and frees it a few seconds later, so an app that binds it in the meantime keeps running.
- e1b6312: The engine is built on a newer Chromium, with its fixes and web platform updates.
- 0f16f99: The engine is built on a newer Chromium, with its fixes and web platform updates.
- 575e7cd: Canceling a page's screen share picker rejects `getDisplayMedia()`, rather than starting a share that ends at once.
- f8c6cc4: A desktop on a second tty or nested in another one no longer breaks the first desktop's portals, notifications or tray. A nested desktop leaves them to its host, and a second login session hands them and the graphical session back when it exits.
- b39d80e: A screen cast that may share a monitor may share a region of one too, so a browser's share picker lets you drag an area.
- 2fe9fb4: A shared screen shows the pointer over the shell's page and browser windows, not only over an app's window.
- 5ef82d2: Apps that ask to share a screen, as Slack and Discord do, can pick a window too.
- ee63a45: The top bar's sharing indicator says what is shared. It is a red "Sharing screen" pill, and its panel lists each source by name with what of it is shared: a window with its application, a screen by make and model, all screens, or part of a screen with its size. A region covering one whole screen is listed as that screen, and one covering every screen as all of them, instead of "Region". `Captured` carries a window's app id, a monitor's description, the monitor a region is on, and a new `Desk` kind.
- 93f015d: The shell's own page can open a file dialog, through the desktop's file picker, and a folder dropped on a page's folder input uploads its files.
- b2004dd: - Sharing from Slack works from Slack's own picker: our picker comes up once, and Slack's second request is canceled instead of taking the same pick.
  - A tiled window that draws at another size than it was given, such as a Slack huddle, is told its size again instead of being stretched.
- 9db9fcb: An app that holds the keyboard can pass it to another of its windows, so Slack's huddle window comes forward when a huddle starts.
- c079b22: Sharing from Slack puts up our picker once: Slack's later asks for windows during the same share are canceled.
- 22213d1: Fix Slack crashing or sharing nothing when sharing a window or the desk: a window picked earlier is no longer handed to a later share, and Slack's second, canceled capture now answers after the pick.
- 067e0c4: Smoother recordings and casts of a whole monitor or the desk: frames are paced on a steady beat instead of dropping one every few dozen, filled once when sent instead of on every engine frame, and drawn on the GPU with one read back instead of reading back and scaling each monitor on the CPU.
- 623fb41: The engine is smaller: it leaves out Chrome's own settings, New Tab page and other pages the desk never opens, WebUI code caches, and, in every language but English, the strings of Chrome's own UI. Web pages' strings stay translated.
- b241f68: A desktop that boots in a different theme from the one its shell remembered no longer stays stuck half faded in and ignoring the pointer. The compositor answers a theme capture with nothing to turn, and a wipe's hold can no longer freeze another view transition.
- 0c58b28: `pointer.warp` takes an `unlessOver` box: the engine leaves the pointer where it is while it is over that box, including over a browser window's page, which the shell cannot see. Manganese passes the newly focused window's frame, so the pointer stays put when it is already on that window.
- eb6b52a: Dragging a browser window's edge no longer holds the whole desktop to the page's pace. While a `<webview>` has the `resizing` attribute, as an `<app>` already could, the page's latest frame stretches to each new box at once instead of the desktop waiting for the page to draw at it. Manganese sets it on every browser window during a resize.
- Updated dependencies [bafd922]
- Updated dependencies [8fa9c05]
- Updated dependencies [3980a9a]
- Updated dependencies [623860a]
- Updated dependencies [a2def76]
- Updated dependencies [9d0934e]
- Updated dependencies [bb92965]
- Updated dependencies [1062efc]
- Updated dependencies [c429bd5]
- Updated dependencies [e455955]
- Updated dependencies [c03a44b]
- Updated dependencies [9fe15f8]
- Updated dependencies [f71cc09]
- Updated dependencies [ab2d2f0]
- Updated dependencies [ecd3fba]
- Updated dependencies [62a671f]
- Updated dependencies [54472b5]
- Updated dependencies [64b22f3]
- Updated dependencies [e42226f]
- Updated dependencies [75b9403]
- Updated dependencies [b49fa3a]
- Updated dependencies [6730912]
- Updated dependencies [2d2289b]
- Updated dependencies [7a29c8f]
- Updated dependencies [a113605]
- Updated dependencies [3ded272]
- Updated dependencies [d4b9da4]
- Updated dependencies [be59aae]
- Updated dependencies [9d4a876]
- Updated dependencies [10ee944]
- Updated dependencies [44d0983]
- Updated dependencies [dc90c70]
- Updated dependencies [5bdc699]
- Updated dependencies [cd02e0e]
- Updated dependencies [5e0723d]
- Updated dependencies [8946a22]
- Updated dependencies [3757596]
- Updated dependencies [1ad2756]
- Updated dependencies [93f015d]
- Updated dependencies [e781b22]
- Updated dependencies [6b2a242]
- Updated dependencies [fccc784]
- Updated dependencies [1fcf33a]
- Updated dependencies [2ce51b8]
- Updated dependencies [3146073]
- Updated dependencies [c15ba93]
- Updated dependencies [2fe5852]
- Updated dependencies [a5bff8c]
- Updated dependencies [a1f9bb9]
- Updated dependencies [341debf]
- Updated dependencies [ae7874c]
- Updated dependencies [c4fe915]
- Updated dependencies [b1041f8]
- Updated dependencies [45c846a]
- Updated dependencies [0bbe0f9]
- Updated dependencies [33444d9]
- Updated dependencies [e645e06]
- Updated dependencies [f8b1742]
- Updated dependencies [e97b6b2]
- Updated dependencies [0abccd9]
- Updated dependencies [96a82ac]
- Updated dependencies [2d0838f]
- Updated dependencies [113dabe]
- Updated dependencies [0bd0d2a]
- Updated dependencies [1971d87]
- Updated dependencies [f45bf2b]
- Updated dependencies [4096040]
- Updated dependencies [de5d134]
- Updated dependencies [6c3db42]
- Updated dependencies [e039233]
- Updated dependencies [0c58b28]
- Updated dependencies [d3847ed]
  - @domicile-desktop/app-settings@0.1.0
  - @domicile-desktop/app-history@0.0.2
  - @domicile-desktop/manganese@1.1.0
  - @domicile-desktop/shell-simple@0.0.2
  - @domicile-desktop/shell-splash@0.0.2
  - @domicile-desktop/builder@0.1.0

## 1.0.0

### Major Changes

- 2056529: The first release.

### Minor Changes

- e90c8ad: On a tty, a touchpad ignores input while a keyboard types. `domicile disable-while-typing [on|off|toggle]` turns it off and on.

### Patch Changes

- d32d8f7: A `domicile://` page can `fetch()` its own files, and only its own.
- 0bf1018: The boot splash crossfades straight into the shell instead of through a white page.
- Updated dependencies [2056529]
- Updated dependencies [0ff84ad]
- Updated dependencies [0bf1018]
  - @domicile-desktop/manganese@1.0.0
  - @domicile-desktop/builder@0.0.1
  - @domicile-desktop/shell-simple@0.0.1
  - @domicile-desktop/app-history@0.0.1
  - @domicile-desktop/app-settings@0.0.1
  - @domicile-desktop/shell-splash@0.0.1
