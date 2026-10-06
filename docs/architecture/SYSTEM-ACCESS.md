# System access for the shell

Proposal: give the shell three generic primitives (files, processes and a
D-Bus client) and build desktop features as TypeScript libraries on them.
Domicile stops adding a message for each feature.

## Problem

The shell reaches the system only through messages Domicile defines. Each
feature a desktop wants is a change to Domicile:

- battery, backlight and audio are `domicile_host` modules, host messages and
  engine IDL members ([HOST-READOUTS.md](/packages/shell-manganese/docs/HOST-READOUTS.md))
- wifi and bluetooth need the compositor to read NetworkManager and BlueZ and
  report them on the host protocol (`ROADMAP.md`, item 13)
- the file chooser in [PORTALS.md](PORTALS.md) adds a `listDirectory()` engine
  member

A shell published on npm cannot add a feature without a change to Domicile.
The set of features grows with what desktops want, so the compositor, the
protocol and the engine grow without bound.

## Design

```
shell page ──── domicile.system ──────▶ engine (opaque relay) ──▶ compositor
                                                                   ├─ files
                                                                   ├─ processes
                                                                   └─ D-Bus (session, system)
```

### Page API

```ts
interface DomicileSystem {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, options?: { atomic?: boolean }): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  stat(path: string): Promise<Stat>;
  watch(path: string): ReadableStream<WatchEvent>;

  spawn(argv: string[], options?: SpawnOptions): Subprocess;

  dbus(bus: "session" | "system"): DBusConnection;
}

interface Subprocess {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  stdin: WritableStream<Uint8Array> | undefined;
  exited: Promise<{ code: number | undefined; signal: string | undefined }>;
  kill(signal?: string): void;
}

interface DBusConnection {
  call(message: DBusCall): Promise<unknown[]>;
  signals(match: DBusMatch): ReadableStream<DBusSignal>;
}
```

- `@domicile-desktop/sdk/system` ships the types and Zod parsers.
- Features are packages on these primitives: `@domicile-desktop/system-battery`
  (UPower), `system-audio` (`pactl`), `system-network` (NetworkManager),
  `system-bluetooth` (BlueZ), `system-backlight` (sysfs and logind).

### What stays in Domicile

| Stays | Why |
|---|---|
| Windows, input, rendering, Wayland protocols | only the compositor and engine can do them |
| The lock and PAM | must outlive the page ([LOCK.md](/docs/LOCK.md)) |
| Notifications, tray, portals | D-Bus servers that own a bus name |
| The home file index | speed; revisit once `readDir` and `watch` exist |

Everything else moves to libraries on the primitives.

### Wire

- Page to compositor: `system_request { id, request }`. `request` starts a
  call (`read_file`, `write_file`, `read_dir`, `stat`, `watch`, `spawn`) or
  drives one running under the same `id` (`unwatch`, `stdin`, `close_stdin`,
  `kill`). D-Bus calls are to come.
- Compositor to page: one `system_reply` per call that starts something
  (`failed` included), then for a watch or process any number of
  `system_event` and one `system_end`. Bytes are base64.
- Types: `domicile_protocol::SystemRequest` and its neighbors. The executor is
  `domicile_host::system`, one per chrome connection.
- The engine relays both as opaque strings: one IDL method, one event. Adding
  a request type changes `domicile-protocol`, the compositor and the SDK, not
  the engine.
- Large files for display (`<img>`, `<video>`) keep using
  [`domicile://home/`](DOMICILE-SCHEME.md).

### Security

The shell is trusted code: `Spawn` already runs any argv. These rules keep that
trust from reaching anything else.

- **Binding:** only the top-level `domicile://shell` frame gets
  `domicile.system`. `<webview>` guests, extensions and
  `domicile://home` never do. Same check as the control channel.
- **Content Security Policy:** `domicile://shell` serves `script-src 'self'`.
  A script injected through a notification body, window title or file name
  does not run.
- **argv only:** no shell string. A shell that wants `sh -c` passes it.
- **Lock:** `crate::lock::refused` covers every system call. While locked:
  - a call that starts something fails with `locked`, except a read, stat,
    listing or watch of an absolute path under `/sys` with no `..`, so a lock
    screen can show the battery
  - `stdin` is dropped; `unwatch`, `close_stdin` and `kill` are allowed
  - processes and watches started before the lock keep running
- **Lifetime:** a page's processes, watches and matches end when its
  connection closes, so a reload or `domicile load-shell` leaks nothing.

## Key decisions

- **Primitives over a message per feature.** Shell authors add features
  without changing Domicile. GNOME Shell (GIO), AGS/Astal and Quickshell expose
  the same three primitives.
- **D-Bus as a primitive, over `spawn("busctl", …)`.** NetworkManager, BlueZ,
  UPower, MPRIS, logind and power-profiles are D-Bus services. Parsing
  `busctl` output is fragile and loses types.
- **In the compositor, over the engine's browser process.** The compositor
  enforces the lock, already spawns clients and already runs `zbus`. Its
  Rust tests run without a GPU. Work runs on the chrome connection's thread,
  never the Wayland thread.
- **Opaque relay in the engine, over typed IDL members.** A typed member per
  request would make the engine grow again. The SDK parses replies with Zod
  ([DATA.md](/docs/guidelines/DATA.md)).
- **Libraries own system details.** A `pactl` or sysfs format change breaks
  one package, which its tests cover with recorded output.
- **The libraries carry the safety rules that leave Rust.** For example,
  `system-backlight` never sets the level to zero, which
  `domicile_host::backlight` enforces today.

## Plan

- [x] the wire types in `domicile-protocol` and the TypeScript schemas (`e2e-harness`)
- [x] the compositor serves files, watches and processes; `lock::refused`
      covers them
- [ ] engine patch: opaque relay, binding for the top-level shell frame only,
      `script-src 'self'` on `domicile://shell`
- [ ] `@domicile-desktop/sdk/system`
- [ ] the compositor serves D-Bus calls and matches
- [ ] `system-battery`; delete `domicile_host::battery`, its host message and
      IDL member
- [ ] `system-backlight`; delete `domicile_host::backlight` and its messages
- [ ] `system-audio`; delete `domicile_host::audio`, the meters and their
      messages
- [ ] apps and bookmarks as libraries; delete `search_apps` and `found_apps`
- [ ] `system-network` and `system-bluetooth`, with bar items in manganese
- [ ] [PORTALS.md](PORTALS.md)'s file chooser uses `readDir`; drop its
      `listDirectory()`

## Open questions

- **How a library finds `pactl` and other binaries.** Recommendation: the
  home-manager module puts them on the compositor's `PATH`, which spawned
  processes inherit. Libraries name the bare binary.
- **Cold start after a reload.** Each library reads its state again, so the bar
  is empty until the first reply. Recommendation: accept it; each reply takes
  milliseconds.
