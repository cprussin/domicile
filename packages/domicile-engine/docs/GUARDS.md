# Guards and spikes

End-to-end checks in `scripts/`. Each guard runs a real engine and exits
non-zero on failure. Most have a control run: the same run with one thing
changed, where the result must differ. If a guard checks that something does
not happen, its control makes it happen, which proves the guard can detect it.

A headless guard's compositor stand-in (`*-compositor.py`,
`guard-webview-keyboard-socket.py`) says nothing until the browser's `hello`,
like the real compositor. `/scripts/test-the-guard-stand-ins-wait-for-hello.sh`
checks this.

Every guard and spike starts Chrome with `--disable-component-update`.
Otherwise Chrome downloads components into `$TMPDIR`, and a guard stops it
before the download finishes, leaving 85-195M per run in the runner's tmpfs
`/tmp`. `/scripts/test-the-guards-disable-component-updates.sh` checks this.

CI runs them through `/scripts/engine-guard-*.sh`. Run one by hand inside the
toolchain shell ([BUILD-MACHINE.md](BUILD-MACHINE.md#toolchain-shell)).

## Helpers

| Script | Role |
|---|---|
| `under-wayland.sh` | runs another script under a nested wlroots compositor on the GPU, the only setup that can import a dmabuf |
| `guard_webview_devtools.py` | sends keys and clicks to a running engine over the debugging port |
| `guard-webview-guest-page.py` | the guest page for the keyboard and click guards |
| `lib-annotate.sh` | reports where a guard stopped as a GitHub annotation |
| `lib-last-words.sh` | prints the end of an engine's log, reaching back to a crash's fatal line |
| `lib-latency.sh` | reads a latency run's log; also used by `/scripts/test-latency-report.sh` |
| `lib-compositor-cleanup.sh` | stops a nested compositor and its whole process group |
| `lib-control-budget.sh` | sizes a control's timeout from how long its guard took |
| `lib-ports.sh` | gives each guard free ports, since two engine jobs share `crux` |
| `lib-profile.sh` | removes a guard's profile at exit, retrying while the engine's children still write into it |

## Compositing

Under `under-wayland.sh` unless marked headless.

| Guard | Checks |
|---|---|
| `guard-client-window.sh` | a Wayland client's window appears on the page in the color it drew |
| `guard-two-windows.sh` | two clients' windows on one page, in one aggregation |
| `guard-buffer-transform.sh` | a `wl_shm` buffer drawn with `wl_surface.set_buffer_transform` is shown upright |
| `guard-scrolling-bubble.sh` | each frame of a monitor cast shows a sync bubble at the content its window scrolls, on a page that syncs frames. Control: the page places each move a step late, and the bubble is off its content |
| `guard-app-survives-load-shell.sh` | a client's frames still reach the page after `load_shell`, when the new shell's `<app>` is a different size |
| `guard-shell.sh` | a real shell, built with vite and the SDK, showing a client's window on a desktop `domicile` started |
| `guard-shell-handover.sh` | the engine calls `Shell` with the body and a working desktop, and no `navigator.domicile` or `window.domicile` exists (patch 0094) |
| `guard-css-and-resize.sh` | CSS parity of `<app>` against `<div>`, with and without `backdrop-filter`, plus resize and latency. Headless; `GPU=1` uses the GPU |
| `guard-latency.sh` | keystroke to pixel with a real client, from the compositor's `latency` lines |
| `guard-app-only-in-shell.sh` | `<app>`, `HTMLAppElement` and `canvas.embedExternalSurface()` exist in the shell and not in a site in its `<webview>`. Headless |
| `guard-app-module.sh` | `run_app` runs an app module: its `main` gets a `DomicileAppHost` and its system call reaches the compositor after `app_hello`. Control: the app's address in an unpinned window runs nothing. Headless |
| `guard-app-routes-input.sh` | `<app>` sends the pointer, wheel and keys to its client through its whole CSS transform, with no page script; a `<div>` control gets nothing |
| `guard-windows-state.sh` | `windows`, `focusedWindow` and the appearance attributes follow the compositor, every event name fires, and every CSS cursor keyword reaches the page; and that a system call and its answer cross the browser. Headless |
| `guard-portal-requests.sh` | a shell that listens late for `portalrequests` hears them; `answerPortalRequest` reaches the compositor and a malformed answer does not. Headless |
| `guard-desk-state.sh` | the desk's state attributes (idle, lock, themes, clipboard, tray with each icon's bus, menu and `itemIsMenu`, modifiers) say what the compositor said, to a shell that reads without listening; the pointer theme on `appearance` reaches the browser process. Headless |
| `guard-held-moments.sh` | a `focusrequested` sent before the shell listens reaches its first listener, once. Headless |
| `guard-asks-promise.sh` | `searchFiles()` resolves with its answer, and a newer search rejects the older with an `AbortError`. Headless |
| `guard-shortcut-chords.sh` | a chord grabbed by name is resolved against the compositor's keyboard, taken from the page and released by name, and given back once every grab is ungrabbed; a bad or untypable chord throws. Headless |
| `guard-desktop-geometry.sh` | the engine reports desktop size and density to the compositor without the page's help, and the page has the whole window (patch 0095). Headless |
| `guard-shortcuts-inhibitor.sh` | a nested engine sends `inhibit_shortcuts` to the host (patch 0038) |
| `guard-shortcuts-inhibitor-chord.sh` | sway honors it: `Mod4+y` reaches the page, not sway. Needs a reachable sway |

Results: [ENGINE-FORK-MEASUREMENTS.md](/docs/architecture/ENGINE-FORK-MEASUREMENTS.md).

## Shell page

Headless.

| Guard | Checks |
|---|---|
| `guard-shell-shortcuts.sh` | Chrome's reload, back, fullscreen, zoom, close and quit keys do nothing to the shell (patch 0047) |
| `guard-shell-local-network.sh` | the shell loads an image from loopback with no Local Network Access prompt (patch 0066) |
| `guard-shell-web-apis.sh` | the shell may show notifications and read cross-origin responses (patches 0066, 0105) |
| `guard-shell-script-src.sh` | an injected inline `<script>` and `onerror` do not run in the shell; a `<script src>` from the shell root does |
| `guard-video-codecs.sh` | the engine plays H.264 and AAC (`src/build/args/domicile_codecs.gn`); VP9 is the control |
| `guard-display-capture.sh` | a display capture through the C ABI reads back the shell's color, before and after a resize |

## Browser windows (`<webview>`)

Headless.

| Guard | Checks |
|---|---|
| `guard-webview-framing.sh` | a site that refuses framing still shows |
| `guard-webview-notifications.sh` | a page must ask before it notifies, even in a profile that stores an allow-all default (patch 0105) |
| `guard-webview-history.sh` | back, forward, reload and stop; the element's navigation state, load progress, address and connection security |
| `guard-webview-untrusted-cert.sh` | an https page with a self-signed certificate reads `security` `dangerous`; the same certificate trusted reads `secure` |
| `guard-webview-find.sh` | find in page, including a cross-site frame; find next starts from the active match (patch 0073) |
| `guard-webview-keyboard.sh` | a desktop shortcut pressed in a guest is caught; an unclaimed Ctrl+R goes to the shell as `domicile-guest-keydown` |
| `guard-webview-escape.sh` | Escape with an unfocused browser window does not crash the browser (patch 0037) |
| `guard-webview-browser-page.sh` | `chrome://history` in a browser window is refused by `BrowserPageThrottle` (patch 0083) |
| `guard-webview-click.sh` | a click in a browser window fires an event in the shell's document |
| `guard-webview-activate.sh` | a page brought to the front (`Page.bringToFront`, the same `Activate()` as a notification click's `client.focus()`) fires `domicile-focus-request` |
| `guard-webview-routed-link.sh` | a middle click on a link opens a browser window through `OpenURLFromTab` |
| `guard-webview-target-url.sh` | the link under the pointer reaches the shell as `targetUrl`, clears when the pointer leaves the page, and returns when it comes back |
| `guard-webview-device-request.sh` | a page's `navigator.hid.requestDevice()` from a press asks the shell as `domicile-device-request`, and the shell's cancel reaches the page as no devices |
| `guard-webview-dialog.sh` | a page's `prompt()` from a press asks the shell as `domicile-dialog`, and the shell's text reaches the page as `prompt()`'s value |
| `guard-webview-beforeunload.sh` | `closeBrowserWindow` on a page whose `beforeunload` asks to stay asks the shell as a `beforeunload` dialog; Cancel keeps the window and Leave closes it |
| `guard-webview-fullscreen.sh` | a page enters fullscreen from its own button, the shell hears it as `pageFullscreen`, and Escape (typed on a swapped Caps Lock) and `exitPageFullscreen()` each take it out |
| `guard-webview-context-menu.sh` | a right click fires `domicile-context-menu` with the link and image under it; its `inspect` opens DevTools in a browser window (patch 0092); a right click in DevTools draws its HTML menu; closing the inspected window closes DevTools' too, and the engine survives it |
| `guard-webview-new-window.sh` | a `target="_blank"` form opens a browser window, the shell's `<webview window>` shows it, and its page gets the form's POST |
| `guard-webview-window-open.sh` | a page's `window.open()` returns a handle, the window is listed, keeps its opener and name, and posts back to its opener (patch 0115) |
| `guard-webview-private.sh` | a cookie set in a `<webview private>` reaches private pages and windows, never ordinary ones; a private window is listed `isPrivate`; the cookie is gone once every private page closes |
| `guard-webview-app-window.sh` | an app window (`open_url` with `"app":true`) is listed `isApp` and records no visits; an ordinary window opened after it is recorded |
| `guard-webview-survives-load-shell.sh` | a browser window's page keeps running across `load_shell`, and the new shell's `<webview window>` shows it |
| `guard-webview-hidden.sh` | a browser window's page is hidden while its `<webview>` is `display: none`, visible once shown, and hidden again after |
| `guard-webview-permissions.sh` | a page's `getUserMedia` asks the shell over `domicile-permission-request`; the shell's allow reaches the page and is stored for the site (patch 0103) |
| `guard-webview-media-devices.sh` | a `<webview>` lists the fake cameras, and `setMediaDevice` puts the chosen one first, the camera a page that names none gets (patch 0117) |
| `guard-webview-upload.sh` | `<input type="file">` asks the shell over `domicile-file-chooser`, and the page reads the chosen file (patch 0053) |
| `guard-webview-download.sh` | a download asks the shell, lands at the chosen path (patch 0053), and is counted in progress, then as finished until the shell clears it |
| `guard-webview-save-picker.sh` | `showSaveFilePicker()` asks the shell (patch 0086) |
| `guard-webview-passkey-extension.sh` | WebAuthn requests reach an extension on `chrome.webAuthenticationProxy` (patches 0048, 0069, 0084) |

## Extensions

Headless.

| Guard | Checks |
|---|---|
| `guard-webview-content-script.sh` | a `--load-extension` content script runs in a `<webview>` |
| `guard-extension-installer.sh` | an extension named in the compositor's `extensions` message is installed (patch 0055) |
| `guard-extension-tray.sh` | the tray event, popup, content size and `window.close()` (patches 0056, 0080 to 0082) |
| `guard-webview-tabs.sh` | `tabs.query` and `tabs.setZoom` target the focused `<webview>` (patch 0057) |
| `guard-webview-active-tab.sh` | a tray click grants `activeTab` to the focused tab |
| `guard-webview-popup-window.sh` | `windows.create({type: "popup"})` opens a browser window the shell draws at the requested size |

## Spikes

Standalone checks of `<app>` embedding. Run by hand unless noted.

| Script | Does |
|---|---|
| `spike.sh` | runs one spike step; the producer's exit code is the result. `guard-css-and-resize.sh` calls it |
| `spike-page.html`, `spike-css-page.html`, `spike-resize-page.html` | the pages for `spike.sh` and the CSS run, served from `domicile://shell/`, the only origin with `<app>` |
| `spike-engine.sh` | drives `libdomicile_engine.so` from a C process |
| `spike-dmabuf.sh` | imports, submits and releases a real dmabuf; under `under-wayland.sh` |
| `spike-iframe.sh` | compares `<app>` with an out-of-process `<iframe>`. Does not run: its page is an http page, which has no `<app>` |
