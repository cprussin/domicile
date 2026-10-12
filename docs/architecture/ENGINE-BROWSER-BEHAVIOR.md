# Engine: browser behavior

The engine's browser leaves keys, clicks and credentials to the shell. Every
`Browser` the engine opens is a shell window. Part of the
[engine fork](ENGINE-FORK.md).

## Keys, clicks and gestures

Patch `0047`:

- Every key reaches the page. An unhandled key stays unhandled: no reload,
  back, F11, zoom, close or quit.
- A right click is only the page's `contextmenu` event.
- Edge swipes do nothing.
- Ctrl+wheel scrolls, in the shell and in browser windows (patch `0112`). The
  page still sees `ctrlKey`.

In a browser window (`WebViewGuest`):

- A right click the page leaves alone goes to the shell as
  `domicile-context-menu` (patch `0092`). The shell draws the menu and sends
  the chosen action back with `event.run()`.
- `inspect` opens DevTools in a browser window at DevTools' address.
  `chrome/browser/domicile/domicile_devtools.h` attaches it.
- A chord the page does not handle goes to the shell.

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

## Guards

- `guard-shell-shortcuts.sh`: keyboard.
- `guard-webview-passkey-extension.sh`: passkeys.
- `guard-shortcuts-inhibitor.sh` and `guard-shortcuts-inhibitor-chord.sh`: the
  engine sends the inhibit request, and sway honors it. See
  [ENGINE-FORK-MEASUREMENTS.md](ENGINE-FORK-MEASUREMENTS.md#host-shortcut-inhibitor).
- `guard-webview-context-menu.sh`: the context menu and DevTools.
- `guard-webview-permissions.sh`: permission requests and site settings.
- `guard-webview-device-request.sh`: device requests.
- No guard reads the browser's offers.
