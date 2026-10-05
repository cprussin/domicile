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
shell page ── window.domicile.system ──▶ engine (opaque relay) ──▶ compositor
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

- Page to compositor: `SystemRequest { id, request }`, with `request` one of
  `ReadFile`, `WriteFile`, `ReadDir`, `Stat`, `Watch`, `Spawn`, `Stdin`,
  `Kill`, `DBusCall`, `DBusMatch`, `Cancel`.
- Compositor to page: `SystemReply { id, reply }`, plus `SystemChunk { id,
  data }` and `SystemEnd { id, outcome }` for streams. Bytes are base64.
- The engine relays both as opaque strings: one IDL method, one event. Adding
  a request type changes `domicile-protocol`, the compositor and the SDK, not
  the engine.
- Large files for display (`<img>`, `<video>`) keep using
  [`domicile://home/`](DOMICILE-SCHEME.md).

### Security

The shell is trusted code: `Spawn` already runs any argv. These rules keep that
trust from reaching anything else.

- **Binding:** only the top-level `domicile://shell` frame gets
  `window.domicile.system`. `<webview>` guests, extensions and
  `domicile://home` never do. Same check as the control channel.
- **Content Security Policy:** `domicile://shell` serves `script-src 'self'`.
  A script injected through a notification body, window title or file name
  does not run.
- **argv only:** no shell string. A shell that wants `sh -c` passes it.
- **Lock:** `crate::lock::refused` covers every `SystemRequest`. While locked:
  - `Spawn`, `WriteFile`, `DBusCall` and new `DBusMatch` are refused
  - `ReadFile`, `ReadDir`, `Stat` and `Watch` are answered only under `/sys`,
    so a lock screen can show the battery
  - streams opened before the lock keep running
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

- [ ] `SystemRequest`, `SystemReply`, `SystemChunk`, `SystemEnd` in
      `domicile-protocol`, versioned
- [ ] the compositor serves files and processes; `lock::refused` covers them
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
