# Engine: browser behavior

The engine's browser leaves keys, clicks and credentials to the shell. Every
`Browser` the engine opens is a shell window. Part of the
[engine fork](ENGINE-FORK.md).

## Keys, clicks and gestures

Patch `0047`:

- Every key reaches the page. An unhandled key stays unhandled: no reload,
  back, F11, zoom, close or quit.
- A right click is only the page's `contextmenu` event.
- Ctrl+wheel and edge swipes do nothing.

In a browser window (`WebViewGuest`):

- A right click the page leaves alone goes to the shell as
  `domicile-context-menu` (patch `0092`). The shell draws the menu and sends
  the chosen action back with `event.run()`.
- `inspect` opens DevTools in a browser window at DevTools' address.
  `chrome/browser/domicile/domicile_devtools.h` attaches it.
- DevTools draws its own context menus in HTML (its soft menu), since the
  engine has no native menus. The shell gets no `domicile-context-menu` from
  it. Copy actions write the frame's clipboard, as a page's copy does.
- A chord the page does not handle goes to the shell.
- Ctrl+wheel goes to the shell as a zoom request.

The shell binds browser keys itself.

## Passwords and passkeys

Patch `0048`:

- No password manager, autofill or translate.
- WebAuthn has no browser UI and reports no platform authenticator.

Passkeys belong to extensions ([EXTENSIONS.md](EXTENSIONS.md)):

- `PublicKeyCredential` stays, for a content script to wrap.
- An origin a `webAuthenticationProxy` extension has taken still gets a request
  delegate.
- `isConditionalMediationAvailable()` returns true for origins no extension
  proxies. Patch `0084` holds a conditional `get()` until the site aborts it, so a passkey
  extension's autofill can answer it.

## HTTP pages

- HTTPS-First Mode is off, in every profile and private window:
  `domicile::TurnOffBrowserOffers` sets its prefs on each start. Chrome warns
  before an http page with a dialog on the page's tab, and a `<webview>` guest
  has no tab, so the page stays blank.
- HTTPS Upgrades stay on. An http address tries https first and falls back to
  http when https fails. The shell's address bar marks the page not secure.

## Device choosers

Patch `0110`:

- WebHID, WebUSB and Web Serial ask the shell to pick a device. Chrome's
  chooser is a bubble on a browser window, which a `<webview>` guest has none
  of.
- `//chrome/browser/domicile/domicile_device_chooser.h` sets Chrome's override.
  Chrome's controllers still list the devices and grant the one picked.
- Web Bluetooth's chooser goes the same way. Its scanning prompt, which picks
  no device, is refused.
- A page outside any guest gets no device.

## New windows

- A page's `target="_blank"` or `window.open()` makes a real window: content
  keeps the opener, the name and a form's POST body.
- Content CHECKs that a guest's opener has a guest SiteInstance, which needs a
  partition of its own and would log the user out of every site. Patch `0115`
  relaxes it for guests without one.
- A `<webview partition>` and a window opened in a partition have a guest
  SiteInstance in a StoragePartition of their own (`ParamsFor` in
  `web_view_guest.cc`), so their new windows keep the partition.
- `WebViewGuest::CreateNewGuestWindow` makes the page as a browser window, and
  `AddNewContents` lists it once the page shows it.
- A middle click and an extension's window open at the address with no
  opener (`ReportNewWindow`).

## Navigations

- `WillNavigateThrottle` defers a page's own main-frame navigation and asks
  the element (`domicile-will-navigate`), as Electron's `will-navigate`.
  `preventDefault()` cancels it before any request. The shell's `src`,
  history steps and reloads do not ask (`AsksBeforeNavigating`).
- A closed element answers yes, so a navigation never hangs.

## Dialogs

- `alert()`, `confirm()` and `prompt()` ask the shell. A guest's
  `WebViewGuest` is its `JavaScriptDialogManager`; content dismisses every
  dialog without one.
- One at a time (`GuestDialogs`). A second one, from another frame's process,
  is dismissed at once.
- A navigation or close cancels the open dialog and withdraws it from the
  shell.
- A `beforeunload` that asks to stay asks the shell too, as a dialog of type
  `beforeunload` (`RunBeforeUnloadDialog`). Unanswered, it leaves, as with no
  manager, so a shell that draws no dialog never traps a page.
- The shell's `closeBrowserWindow` runs the page's `beforeunload`
  (`WebViewGuest::AskToClose`, `DispatchBeforeUnload`) and closes in
  `BeforeUnloadFired` if the page agrees. A page with no handler closes at
  once. `window.close()` and `chrome.tabs.remove` close without asking.
- Patch `0114` only lists the event's files for the build.

## Host shortcuts when nested

Under a host compositor, the engine inhibits the host's shortcuts so the shell
gets its Meta chords.

- Patch `0038` creates a `zwp_keyboard_shortcuts_inhibitor_v1` through
  `WaylandKeyboard::CreateShortcutsInhibitor`. Upstream calls it only for the
  Keyboard Lock API on a fullscreen window, and a nested desktop is not
  fullscreen.
- `--domicile-inhibit-host-shortcuts` turns it on. `domicile-launch` passes it
  on the Wayland platform only, so a guard running `--ozone-platform=wayland`
  does not swallow the session's keymap.

## Clients' shortcut inhibitors

Domicile's compositor serves `zwp_keyboard_shortcuts_inhibit_manager_v1` to
its own clients. A window holding an inhibitor gets the shell's grabbed chords
while it has the keyboard. See
[KEYBINDINGS.md](KEYBINDINGS.md#key-decisions). This is the other direction
from patch `0038`, which is the engine asking a host compositor.

## Chrome's own pages and strings

The engine leaves out Chrome's own UI, which the shell replaces.

- Patch `0146`: Settings, the New Tab page, the password manager, What's New
  and the WebUI gallery are not registered. Their paks, and those of tab
  search, the side panels and Customize Chrome, are not in `resources.pak`.
- Patch `0147`: every locale but en-US carries only the strings a desk can
  show. `src/components/domicile/locales/foreign_allowlist.py` lists what it
  drops. en-US keeps every string, and `ResourceBundle` reads it for a string
  a locale lacks.
  - A Chrome string the desk does show, dropped by mistake, appears in
    English. Take its source or prefix off the lists.
- `src/build/args/domicile_trim.gn`: no WebUI code caches.

## Guards

- `guard-shell-shortcuts.sh`: keyboard.
- `guard-webview-passkey-extension.sh`: passkeys.
- `guard-shortcuts-inhibitor.sh` and `guard-shortcuts-inhibitor-chord.sh`: the
  engine sends the inhibit request, and sway honors it. See
  [ENGINE-FORK-MEASUREMENTS.md](ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
- `guard-webview-context-menu.sh`: the context menu and DevTools.
- `guard-webview-permissions.sh`: permission requests and site settings.
- `guard-webview-device-request.sh`: device requests.
- `guard-webview-dialog.sh` and `guard-webview-beforeunload.sh`: dialogs.
- `guard-webview-partition.sh`: partitions.
- `guard-webview-will-navigate.sh`: will-navigate.
- No guard reads the browser's offers.
