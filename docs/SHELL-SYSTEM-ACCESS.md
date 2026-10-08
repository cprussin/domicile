# System access for shells

A shell reaches the system through three primitives: files, processes and a
D-Bus client. Desktop features (battery, audio, network, apps) are TypeScript
libraries on them, so a shell adds a feature without a change to Domicile.

```
shell page ─ domicile.callSystem() ─▶ engine (opaque relay) ─────▶ compositor
                                                                  ├─ files
                                                                  ├─ processes
                                                                  └─ D-Bus (session, system)
```

## Page API

```ts
import { system } from "@domicile-desktop/sdk/system";

export const Shell = async (root, domicile) => {
  const host = system(domicile);
  const charge = await host.readTextFile("/sys/class/power_supply/BAT0/capacity");
  const changes = await host.spawn(["pactl", "subscribe"]);
};
```

- Each call resolves a `Result<T, SystemError>`. A process's output and a
  watch's changes are `ReadableStream`s. The SDK's types are the reference.
- `dbusCall()` and `dbusMatch()` reach the session and system buses. A body is
  JSON read against its D-Bus signature; `domicile_host::dbus_json` documents
  the mapping.
- `screenshot()` takes an interactive Screenshot portal screenshot as if the
  shell were the app: `<PortalDialogs />` draws the dialog, and the call
  resolves with the saved PNG's path, or fails `canceled`.
- Spawned programs are found on the compositor's `PATH`. The Nix wrapper
  appends `pactl`, `parec` and `curl`, so a user's own copies win.
- A reload starts every library from nothing: each reads its state again, so a
  readout is empty until its first reply.

## Libraries

| Package | Source |
|---|---|
| `@domicile-desktop/system-battery` | UPower over D-Bus |
| `@domicile-desktop/system-backlight` | sysfs, `udevadm monitor`, logind `SetBrightness` |
| `@domicile-desktop/system-audio` | `pactl` and `parec` |
| `@domicile-desktop/system-network` | NetworkManager, iwd or wpa_supplicant over D-Bus |
| `@domicile-desktop/system-bluetooth` | BlueZ over D-Bus |
| `@domicile-desktop/system-apps` | desktop entries, icons and bookmarks |
| `@domicile-desktop/sdk/file-preview` | a launcher's file preview: directory entries, text, audio tags and cover |

Each library owns its system's format and the safety rules for it (for
example, `system-backlight` never sets the level to zero), with tests on
recorded output.

## What stays in Domicile

| Stays | Why |
|---|---|
| Windows, input, rendering, Wayland protocols | only the compositor and engine can do them |
| The lock and PAM | must outlive the page ([LOCK.md](LOCK.md)) |
| Notifications, tray, portals | D-Bus servers that own a bus name |
| The home file index and `searchFiles` | speed: only the matches cross to the page |
| Launching apps (`spawn`) | a client outlives a shell reload and runs on the compositor's Wayland display |
| Clipboard history (`copyClipboardEntry`) | the compositor serves the paste, so it outlives the client that copied; full text stays out of the page ([CLIPBOARD.md](../packages/shell-manganese/docs/CLIPBOARD.md)) |
| Theme (`theme`, `windowsTheme`) | clients read it from the portal's `Settings`; the compositor switches them only after every chrome captures its old frame |

## Wire

- Page to compositor: `system_request { id, request }`. `request` starts a
  call (`read_file`, `write_file`, `read_dir`, `stat`, `watch`, `spawn`,
  `dbus_call`, `dbus_match`, `screenshot`) or drives one running under the
  same `id` (`unwatch`, `stdin`, `close_stdin`, `kill`). `read_file` takes an
  optional byte range, `offset` and `length`.
- Compositor to page: one `system_reply` per call that starts something
  (`failed` included), then for a watch or process any number of
  `system_event` and one `system_end`. Bytes are base64.
- Types: `domicile_protocol::SystemRequest` and its neighbors. The executor is
  `domicile_host::system`, one per chrome connection, on the connection's
  thread.
- The engine relays both as opaque strings: `callSystem(id, request)` and the
  `system` event, a `MessageEvent` whose `data` is the line. A new request
  type changes `domicile-protocol`, the compositor and the SDK, not the
  engine.
- Large files for display (`<img>`, `<video>`) use
  [`domicile://home/`](architecture/DOMICILE-SCHEME.md).

## Security

The shell is trusted code: it can already spawn any argv. These rules keep
that trust from reaching anything else.

- **Binding:** only the `domicile` that the engine hands to `Shell` in a
  `domicile://shell` document has `callSystem()`, through the control
  channel's own binding. `<webview>` guests, extensions and `domicile://home`
  never do.
- **Content Security Policy:** `domicile://shell` serves `script-src 'self'`.
  A script injected through a notification body, window title or file name
  does not run ([SHELL-PACKAGING.md](SHELL-PACKAGING.md#scripts)).
- **argv only:** no shell string. A shell that wants `sh -c` passes it.
- **Lock:** `crate::lock::refused` covers every system call. While locked:
  - a call that starts something fails with `locked`, except:
    - a read, stat, listing or watch of an absolute path under `/sys` with no
      `..`
    - the calls `system-battery`, `system-backlight` and `system-audio` make,
      matched field by field, so a lock screen shows the battery and sets the
      brightness and volume ([LOCK.md](LOCK.md#lock-screen-readouts))
  - `stdin` is dropped; `unwatch`, `close_stdin` and `kill` are allowed
  - processes and watches started before the lock keep running
- **Lifetime:** a page's processes, watches and matches end when its
  connection closes, so a reload or `domicile load-shell` leaks nothing.

## Why

- **Primitives over a message per feature.** GNOME Shell (GIO), AGS/Astal and
  Quickshell expose the same three.
- **D-Bus as a primitive, over `spawn("busctl", …)`.** NetworkManager, BlueZ,
  UPower, MPRIS and logind are D-Bus services; parsing `busctl` output loses
  types.
- **In the compositor, over the engine's browser process.** The compositor
  enforces the lock, already spawns clients and already runs `zbus`, and its
  Rust tests run without a GPU.
- **Opaque relay in the engine, over typed IDL members.** A member per request
  would grow the engine with every feature. The SDK parses replies with Zod.
