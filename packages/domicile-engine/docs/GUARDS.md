# Guards and spikes

End-to-end checks in `scripts/`. Each guard runs a real engine and exits
non-zero on failure. Most have a control run: the same run with one thing
changed, where the result must differ. If a guard checks that something does
not happen, its control makes it happen, which proves the guard can detect it.

CI runs them through `/scripts/engine-guard-*.sh`. Run one by hand inside the
toolchain shell ([BUILD-MACHINE.md](BUILD-MACHINE.md#toolchain-shell)).

## Helpers

| Script | Role |
|---|---|
| `under-wayland.sh` | runs another script under a nested wlroots compositor on the GPU, the only setup that can import a dmabuf |
| `guard_webview_devtools.py` | sends keys and clicks to a running engine over the debugging port |
| `guard-webview-guest-page.py` | the guest page for the keyboard and click guards |
| `lib-annotate.sh` | reports where a guard stopped as a GitHub annotation |
| `lib-latency.sh` | reads a latency run's log; also used by `/scripts/test-latency-report.sh` |
| `lib-compositor-cleanup.sh` | stops a nested compositor and its whole process group |
| `lib-control-budget.sh` | sizes a control's timeout from how long its guard took |
| `lib-ports.sh` | gives each guard free ports, since two engine jobs share `crux` |

## Compositing

Under `under-wayland.sh` unless marked headless.

| Guard | Checks |
|---|---|
| `guard-client-window.sh` | a Wayland client's window appears on the page in the color it drew |
| `guard-two-windows.sh` | two clients' windows on one page, in one aggregation |
| `guard-shell.sh` | a real shell, built with vite and the SDK, showing a client's window |
| `guard-css-and-resize.sh` | CSS parity of `<app>` against `<div>`, with and without `backdrop-filter`, plus resize and latency. Headless; `GPU=1` uses the GPU |
| `guard-latency.sh` | keystroke to pixel with a real client, from the compositor's `latency` lines |
| `guard-control-arrival.sh` | delay from the compositor's socket to the page, from each event's `arrival` stamp; and that every CSS cursor keyword reaches the page. Headless |
| `guard-desktop-geometry.sh` | the engine reports desktop size and density to the compositor without the page's help. Headless |
| `guard-shortcuts-inhibitor.sh` | a nested engine sends `inhibit_shortcuts` to the host (patch 0038) |
| `guard-shortcuts-inhibitor-chord.sh` | sway honors it: `Mod4+y` reaches the page, not sway. Needs a reachable sway |

Results: [ENGINE-FORK-MEASUREMENTS.md](/docs/architecture/ENGINE-FORK-MEASUREMENTS.md).

## Shell page

Headless.

| Guard | Checks |
|---|---|
| `guard-shell-shortcuts.sh` | Chrome's reload, back, fullscreen, zoom, close and quit keys do nothing to the shell (patch 0047) |
| `guard-shell-local-network.sh` | the shell loads an image from loopback with no Local Network Access prompt (patch 0066) |
| `guard-shell-web-apis.sh` | the shell may show notifications and read cross-origin responses (patches 0066, 0068) |

## Browser windows (`<webview>`)

Headless.

| Guard | Checks |
|---|---|
| `guard-webview-framing.sh` | a site that refuses framing still shows |
| `guard-webview-notifications.sh` | a page's notifications are granted without a prompt (patch 0068) |
| `guard-webview-history.sh` | back, forward, reload and stop; the element's navigation state, address and connection security |
| `guard-webview-find.sh` | find in page, including a cross-site frame; find next starts from the active match (patch 0073) |
| `guard-webview-keyboard.sh` | a desktop shortcut pressed in a guest is caught; an unclaimed Ctrl+R goes to the shell as `domicile-guest-keydown` |
| `guard-webview-escape.sh` | Escape with an unfocused browser window does not crash the browser (patch 0037) |
| `guard-webview-browser-page.sh` | `chrome://history` in a browser window is refused by `BrowserPageThrottle` (patch 0083) |
| `guard-webview-click.sh` | a click in a browser window fires an event in the shell's document |
| `guard-webview-routed-link.sh` | a middle click on a link asks for a new window through `OpenURLFromTab` |
| `guard-webview-context-menu.sh` | a right click fires `domicile-context-menu` with the link and image under it; its `inspect` opens DevTools in a new `<webview>` (patch 0089) |
| `guard-webview-new-window.sh` | a `target="_blank"` link fires `domicile-new-window`, and the new `<webview>` loads it |
| `guard-webview-upload.sh` | `<input type="file">` asks the shell over `domicile-file-chooser`, and the page reads the chosen file (patch 0053) |
| `guard-webview-download.sh` | a download asks the shell and lands at the chosen path (patch 0053) |
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
| `guard-webview-popup-window.sh` | `windows.create({type: "popup"})` opens a shell window (patch 0078) |

## Spikes

Standalone checks of `<app>` embedding. Run by hand unless noted.

| Script | Does |
|---|---|
| `spike.sh` | runs one spike step; the producer's exit code is the result. `guard-css-and-resize.sh` calls it |
| `spike-page.html`, `spike-css-page.html`, `spike-resize-page.html` | the pages for `spike.sh` and the CSS run |
| `spike-engine.sh` | drives `libdomicile_engine.so` from a C process |
| `spike-dmabuf.sh` | imports, submits and releases a real dmabuf; under `under-wayland.sh` |
| `spike-iframe.sh` | compares `<app>` with an out-of-process `<iframe>` |
