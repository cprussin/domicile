# The desktop a shell is handed is the API

Proposal: a shell uses the `domicile` handed to its `Shell` directly, with no
setup.

- The engine reports the desktop's size and density.
- `<app>` routes its own input.
- The engine resolves key chords.
- `@domicile-desktop/sdk` ships only types and pure helpers.
- `DomicileClient` is deleted.

```ts
import type { Shell } from "@domicile-desktop/sdk/shell";

export const Shell: Shell = (root, domicile) => {
  const show = () => {
    root.replaceChildren(
      ...domicile.windows.map(({ appId }) =>
        Object.assign(document.createElement("app"), { appId }),
      ),
    );
  };
  show();
  domicile.addEventListener("windowschanged", show);
};
```

## Problem

Each shell must run setup steps that exist only because the engine's API is
incomplete:

| Step | Why it is needed |
|---|---|
| `new DomicileClient(connectToHost(window))` | Events sent before a listener exists are lost, so the client listens first and buffers. It also reshapes IDL values (`hasSize`, empty strings) and parses `shell_config`'s JSON. |
| `registerElements` | Page script routes input under `<app>` (`pointer-input.ts`, `keyboard-input.ts`). |
| `bindKeys` + `shell_config` | The page resolves chords like `Meta+Shift+l` against the keymap the compositor sends it. |

## Design

### State is attributes; changes are events

Everything with a current value is a readonly attribute on `DomicileHost`, and
a change dispatches `<name>changed` with no payload, as `displayschanged` and
`brightnesschanged` already do. A shell reads, then subscribes. A late listener
misses nothing, so nothing needs buffering.

| Attribute | Replaces |
|---|---|
| `windows: DomicileWindow[]` | `appappeared`, `appclosed`, `appresized`, `apptitled`, `appminsize`, `appmaxsize`, `appcursor`, `popupplaced` |
| `focusedWindow: string \| null` | `focuschanged` |
| `displays`, `brightness` | already attributes, with `displayschanged` and `brightnesschanged` |
| `theme`, `windowsTheme` | `theme`, `windowstheme` |
| `locked`, `idle` | `locked`, `idle` |
| `batteryCharge`, `batteryCharging`; `audioOutputs`, `audioInputs`, `audioPlayback`, `audioRecording`, `audioCards` | `battery`, `audio` |
| `extensions`, `tray`, `notifications`, `clipboard` | the events of those names |
| `altKey`, `ctrlKey`, `shiftKey`, `metaKey` | `modifiers` |

`DomicileWindow` uses optional fields in place of the IDL's `hasSize` and empty
strings: `size?: { width, height }`, `title`, `minSize?`, `maxSize?`, `cursor`,
`popup?: { parent, x, y, grab }`.

### One-off events are queued by the engine

Some messages have no current value: `focusrequested`, `shortcut`.
The engine queues each type until its first listener is attached, then
delivers the queue on a task of its own. One rule replaces
`DomicileClient.#held`. `audiolevels` is not held: it is a meter that flows
only while something listens, and a stale sample is worth nothing.

### Requests return promises

`searchFiles`, `previewFile` and `searchApps` resolve with their result
(`DomicileFileSearch`, `DomicileFilePreview`, `DomicileAppSearch`). A newer
call rejects the pending one with `AbortError`.

### The engine reports size and density

The renderer side of `DomicileHost` sends `innerWidth`, `innerHeight` and
`devicePixelRatio` when the channel binds and on every change.

### `<app>` routes its own input

`HTMLAppElement` forwards pointer, wheel and key events to its client in
surface coordinates. It computes them from its own layout and transform, which
the engine knows exactly. This replaces the script math in `measure.ts` and
`element-transform.ts`. The cancelable focus events are unchanged.

### The engine resolves chords

```ts
domicile.grabShortcut("Meta+Shift+l");
domicile.addEventListener("shortcut", (event) => event.chord); // "Meta+Shift+l"
```

- `DomicileHost` resolves each chord against the keys `shell_config` carries
  and re-resolves on layout change.
- `shortcut` carries the chord, whether pressed in a `<webview>` or on the
  page (taken from the page).
- `shell_config` no longer reaches the page.
- Modes stay in the shell. `bindKeys` grabs each chord and maps a `shortcut`
  in the current mode to an action.

### The SDK is types and helpers

| Module | Kind |
|---|---|
| `domicile-host` | types: `DomicileHost` and its events |
| `shell` | type: `Shell` |
| `app-element`, `webview-element` | types |
| `bind-keys`, `key-action`, `own-keybindings` | helpers: chord grammar, modes |
| `matrix`, `cursor-shape`, `theme`, … | pure helpers |

- Deleted: `domicile-client`, `connect-to-host`, `host-message`,
  `keybindings`, `shortcut-claims`; with `<app>` input, `register-elements`,
  `measure`, `element-transform`, `surface-coordinates`, `pointer-input`,
  `keyboard-input`.
- Moved to `@domicile-desktop/e2e-harness`, their only user: `protocol`,
  `chrome-message`, `newline-frames`, `host-stream`.

## Key decisions

- **Battery, brightness and audio are not attributes.** They become libraries
  on the system primitives in [SYSTEM-ACCESS.md](SYSTEM-ACCESS.md).

- **Attributes plus a bare change event, over events carrying the value.** The
  attribute is the single source of truth. This matches the platform
  (`navigator.onLine` with `online`/`offline`, `screen.orientation` with
  `change`).
- **The engine holds moment events, over a client-side buffer.** The browser
  process is the only place that knows whether a listener exists before it
  dispatches.
- **The new surface lands beside the old, then one step moves every shell.**
  Each engine step adds attributes and events and keeps the ones they replace,
  so `DomicileClient` and the shells keep working untouched; the last step
  rewrites the three shells onto the new surface and deletes the old events
  and the client together. No compatibility layer outlives that step.
- **The desktop is handed to `Shell`, not found on a global.** The shell
  keeps it however it likes (a React context, a variable). The engine runs the
  shell module itself (`DomicileShell`) and passes the desktop into the call,
  so there is no `navigator.domicile` or `window.domicile` and the shell's
  copy is the only one.
- **The do-nothing stand-in goes.** Only Domicile calls a shell, so there is
  no plain-browser case and no null check.

## Plan

Each step ships alone.

- [x] the engine reports size and density; `setDesktopSize`,
      `setDevicePixelRatio`, `desktop-size` and `device-pixel-ratio` go
      (`guard-desktop-geometry.sh`)
- [x] `windows` and `focusedWindow` with `windowschanged` and
      `focusedwindowchanged` (`guard-windows-state.sh`)
- [x] the rest of the state as attributes: theme, lock, idle, battery, audio,
      extensions, tray, notifications, clipboard, modifiers
      (`guard-desk-state.sh`)
- [x] the engine queues moment events until a listener exists
      (`guard-held-moments.sh`)
- [x] search and preview return promises (`guard-asks-promise.sh`)
- [x] chords resolved by the engine: `grabShortcut(chord)` and
      `shortcut.chord` (`guard-shortcut-chords.sh`)
- [x] the shells, `examples/minimal-shell`, WRITING-A-SHELL.md and the SDK
      README use the engine's surface directly; `bindKeys` becomes a pure
      helper over `grabShortcut` and `shortcut`; `DomicileClient` and
      `connect-to-host` go; the wire modules move to `e2e-harness`
- [x] `Shell(root, domicile)`: the shell is handed the desktop
- [x] the engine runs the shell and passes the desktop itself;
      `navigator.domicile` and `window.domicile` go
      (`guard-shell-handover.sh`)
- [ ] the engine drops what nothing reads now: the events the attributes and
      promises replace (`appappeared` and the other seven `app*`,
      `focuschanged`, `files`, …) and `shellconfig`
- [ ] `<app>` routes its own input; `registerElements` and the routing modules go

## Open questions

- **Types from the IDL, or by hand?** `domicile-host.ts` mirrors the IDL by
  hand. Recommendation: by hand until the API settles, then generate from the
  `.idl` files.
