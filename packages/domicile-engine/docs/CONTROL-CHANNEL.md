# Control channel and command socket

The engine has two channels to the rest of Domicile:

- **Control channel** (`DomicileHost`): the shell page and the compositor.
- **Command socket** (`--domicile-command-socket`): the supervisor and the
  engine.

## Control channel

- `DomicileHost` is the shell's API. No page script can find it:
  `DomicileShell` runs the module the shell document names and passes the
  host into `Shell(root, domicile)`. There is no `navigator.domicile` or
  `window.domicile`.
- The browser process speaks the wire protocol (JSON lines to the
  compositor). The page sees typed WebIDL values, so it cannot send a
  malformed message.
- Cost: adding a message is an engine change, and so needs an engine release.

### Members

- **Outbound:** `spawn`, `search_files`, `call_system`,
  `answer_portal_request`, `copy_clipboard_entry`, `activate_tray_item`,
  `dismiss_notifications`, `invoke_notification_action`, `focus_app`,
  `focus_chrome`, `close_app`, `set_app_bounds`, `set_desktop_size`,
  `set_device_pixel_ratio`, `set_theme`, `theme_captured`, `unlock`, `lock`,
  `key`, `pointer_motion`, `pointer_leave`, `pointer_button`, `pointer_axis`.
  The browser also sends `hello` on connect.
- **Inbound:** `welcome`, `app_appeared`, `app_titled`, `app_desktop_id`,
  `app_resized`, `app_min_size`, `app_max_size`, `popup_placed`, `app_closed`,
  `app_cursor`, `modifiers`, `found_files`, `clipboard`, `theme`,
  `windows_theme`, `appearance`, `focus_changed`, `focus_requested`,
  `displays`, `keymap`, `extensions`, `tray`, `notifications`, `shell_config`,
  `idle`, `locked`, `system`, `portal_requests`.
- **Handled in the browser, never sent to the compositor:** `grab_shortcut`,
  `warp_pointer`.
- **Not from the compositor:** `browserwindowschanged`, the desk's browser
  windows, which the browser owns
  (`components/domicile/mojom/browser_windows.mojom`).

### Members with special handling

- **`call_system`** and **`system`** carry the shell's system calls. The
  browser wraps the page's request as a `system_request` line and relays
  `system_reply`, `system_event` and `system_end` lines whole, as a
  `MessageEvent`. It reads nothing else of them; the compositor checks each
  call. See `components/domicile/browser/system_call.h` and
  [SHELL-SYSTEM-ACCESS.md](/docs/SHELL-SYSTEM-ACCESS.md).
- **`portal_requests`** and **`answer_portal_request`** carry portal dialogs.
  See [PORTALS.md](/docs/PORTALS.md).
  - The browser relays `portal_requests` whole, as a `portalrequests`
    `MessageEvent`, and reads nothing but `type`.
  - The renderer keeps the latest line and sends it again to a listener added
    later, so a shell that listens late sees pending dialogs.
  - The browser wraps the page's answer, which must be a JSON object with a
    string `kind`, as an `answer_portal_request` line. See
    `components/domicile/browser/portal_request.h`.
- **`tray`**: each item carries the `bus` it answers on and its dbusmenu
  `menu` path, so a shell drives the menu with `call_system`. See
  [SYSTEM-TRAY.md](/docs/architecture/SYSTEM-TRAY.md).
- **`shell_config`** stops in the renderer. `DomicileHost` reads its keys to
  resolve the chords `grabShortcut` is given by name; none of it reaches the
  page.
- **`keymap`** stops in the browser process. It is the xkb keymap the
  compositor compiled from `input.keyboard`, and it feeds Chromium's
  `KeyboardLayoutEngine`. Without it, off ChromeOS, every printable key decodes
  to `DomKey::UNIDENTIFIED`. See `components/domicile/browser/keyboard_layout.h`.
- **`extensions`** stops in the browser process. It is the desk's
  `[extensions]` list, installed into the profile by
  `chrome/browser/domicile/domicile_extension_installer.h`. See
  [EXTENSIONS.md](/docs/architecture/EXTENSIONS.md).
- **`grab_shortcut`**: the browser holds the grabbed set and matches it in
  `WebViewGuest::PreHandleKeyboardEvent`. The compositor cannot do this: keys
  typed into a `<webview>` guest never reach it. A match comes back as a
  `shortcut` event. A guest's release of a grabbed key or a modifier comes
  back as `ShortcutReleased`, which the page pairs with the press as
  `shortcutrelease`. Chromium drops key-ups after a key-down the delegate
  took, so patch `0100` prehandles every key-up. See `components/domicile/browser/shortcut_registry.h`.
- **`warp_pointer`**: the browser owns the pointer (a DRM cursor plane on a
  tty, the host's pointer when nested), so the compositor cannot move it.
  - Use: focus-follows-mouse desktops. After a keyboard focus change, the
    shell moves the pointer onto the newly focused window.
  - A page may move the pointer only within its own box. Coordinates outside
    are clamped.
  - Logic and tests: `components/domicile/browser/pointer_warp.h`. Execution:
    `chrome/browser/domicile/domicile_pointer_warp.cc`.
- **`displays`** is an attribute, `domicile.displays`, with a
  `displayschanged` event. A component that mounts late can read it.
  - `null`: the compositor has not described a desktop yet.
  - `[]`: the desktop has no screens.

### Outside the control channel

- **Extension tray:** the `extensions` event and `activateExtension()` use
  `components/domicile/mojom/extension_tray.mojom`, a separate browser-side
  pipe. Action state is the browser's own; the compositor never sees it. See
  `chrome/browser/domicile/domicile_extension_tray.h`.
- **Tabs:** to `chrome.tabs` and `chrome.windows`, every `<webview>` is a tab
  and the desk is one window. See `chrome/browser/domicile/domicile_desk.h`.
  Patch 0057 routes Chrome's tab lookups to `DomicileDesk`. Fork versions of
  some `chrome.tabs`/`chrome.windows` functions replace Chrome's.

### Typed values

- **Sizes are `double`.** The compositor sends `f64`, so `800.0` arrives with
  a decimal point. Reading it as an integer gives zero.
- **Modifiers** are `altKey`, `ctrlKey`, `shiftKey`, `metaKey`. The compositor
  has already resolved xkb's masks against the keymap.
- **Shortcuts** are grabbed by chord name, `grabShortcut("Meta+Shift+l")`. A
  `shortcut` event carries the `chord`, `keycode`, `altKey`, `ctrlKey`,
  `shiftKey` and `metaKey`. `keycode` is an evdev code.

### Adding a message

1. Add it to the mojom, the IDL, the browser-side serializer and the Blink
   method. A message that stops in the browser process skips the Blink side.
2. Add it to [Members](#members).
3. For a new event type, add a line to `domicile_event_names.h` in
   `src/third_party/blink/renderer/modules/domicile/`, beside its `on<name>` in
   the IDL.
   - Do not use Blink's `event_type_names.json5`. Most of Blink includes its
     header, so a change there recompiles most of Blink.
   - `scripts/test-engine-event-names.sh` checks that this list, the IDL and
     the events `guard-windows-state` fires agree.
4. Run `bun run generate` in `packages/chrome-sdk` to regenerate the SDK's
   `domicile-host.ts` from the IDL. An event dispatched as anything but a
   plain `Event` also needs its type in `EVENT_TYPES` in
   `codegen/generate-domicile-host.ts`, since `EventHandler` does not say.
   `scripts/test-host-types-match-the-idl.sh` fails until the file is current.

## Command socket

`--domicile-command-socket <path>` makes the engine bind a Unix stream socket.
The supervisor connects, sends one JSON line, reads one reply, and closes.

```
{"type":"load_shell","version":1,"root":"/x/dist","module":"shell.js"}
{"type":"loaded"}   |   {"type":"refused","why":"…"}

{"type":"open_url","version":1,"url":"https://example.com/"}
{"type":"opened"}   |   {"type":"refused","why":"…"}
```

- Without the switch, the engine binds nothing. Every desktop `domicile`
  starts passes one under the run's directory.
- `domicile load-shell <path>` sends `load_shell`. `domicile open-url <url>`
  sends `open_url`. `domicile screenshot <file>` goes to the compositor.
- `open_url` opens a browser window at the address, as a page's
  `target="_blank"` does. The shell gets it in `browserwindowschanged`, so a
  shell mid-reload gets it with every other window. An unparsable URL, or a
  desk with no shell to own the window, is refused.
- It is its own socket because the compositor has no part in choosing the
  shell. The supervisor also passes it at
  launch as `--domicile-shell-root` and `--domicile-shell-module`. See
  [THE-DOMICILE-BINARY.md](/docs/architecture/THE-DOMICILE-BINARY.md).
- It carries a version because the supervisor and the engine are published
  separately, so the two ends can come from different revisions. See
  [DATA.md](/docs/guidelines/DATA.md).

| File (under `src/`) | Role |
|---|---|
| `components/domicile/browser/command_protocol.{h,cc}` | parses a line and returns a reply; unit tested |
| `chrome/browser/domicile/domicile_command_socket.{h,cc}` | the socket and the shell's window; in `//chrome` because reloading needs `GlobalBrowserCollection` |
| `components/domicile/browser/shell_source.{h,cc}` | the shell being served; set from the two switches, replaced by `load_shell` |
| `chrome/browser/domicile/domicile_browser_windows.{h,cc}` | the desk's browser windows; `open_url` opens one |

### Dev reload

- The shell has no reload key (patch 0047).
- Reload a rebuilt shell with `domicile load-shell <path>`. Run it from a
  watch script for live reload.
- `scripts/test-dev-shell.sh` checks the served page has no reload poller.
