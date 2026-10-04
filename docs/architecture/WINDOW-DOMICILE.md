# `window.domicile` is the API

A shell talks to its desktop through `window.domicile` and nothing else. The
engine owns everything a shell needs there. `@domicile-desktop/sdk` ships the
TypeScript for it plus pure helpers, and `DomicileClient` is deleted.

```ts
import type { Shell } from "@domicile-desktop/sdk/shell";

export const Shell: Shell = (root) => {
  const domicile = window.domicile;
  if (domicile == null) return; // a plain browser: no desktop

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

No setup call and nothing to forget: the engine reports the desktop's size and
density, routes input under `<app>`, and resolves key chords.

## Problem

Every shell must construct a `DomicileClient` and then call
`registerElements`, `reportDevicePixelRatio` and `reportDesktopSize`. Each step
exists only because the engine's surface is incomplete:

| Step | Why a shell needs it today |
|---|---|
| `new DomicileClient(connectToHost(window))` | an event dispatched before a listener exists is lost, so the client listens first and buffers; it also reshapes IDL (`hasSize`, empty strings) and parses `shell_config`'s JSON |
| `registerElements` | input under `<app>` is routed by page script (`pointer-input.ts`, `keyboard-input.ts`) |
| `reportDesktopSize`, `reportDevicePixelRatio` | the compositor learns the page's size and density only from the page |
| `bindKeys` + `shell_config` | the page resolves `Meta+Shift+l` against the keymap the compositor sends it |

`examples/minimal-shell` forgets `reportDesktopSize`, and the desktop silently
stays at the compositor's placeholder size.

## Design

### State is properties; changes are events

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

`DomicileWindow` carries optional fields where the IDL has `hasSize` and empty
strings today: `size?: { width, height }`, `title`, `minSize?`, `maxSize?`,
`cursor`, `popup?: { parent, x, y, grab }`.

### Moments are events, and the engine holds the first

Some messages have no current value: `focusrequested`, `openurl`, `shortcut`.
The engine queues each type until its first listener is attached, then
delivers the queue on a task of its own. One rule replaces
`DomicileClient.#held`. `audiolevels` is not held: it is a meter that flows
only while something listens, and a stale sample is worth nothing.

### Requests return promises

`searchFiles`, `previewFile` and `searchApps` resolve with their answer
(`DomicileFileSearch`, `DomicileFilePreview`, `DomicileAppSearch`) instead of
answering on a separate event (`files`, `filepreview`, `apps`). A newer call
supersedes an older one, which rejects with `AbortError`.

### The engine reports size and density

The renderer half of `DomicileHost` sends the page's `innerWidth`,
`innerHeight` and `devicePixelRatio` when the channel binds, and again on every
change. `setDesktopSize` and `setDevicePixelRatio` leave the IDL.

### `<app>` routes its own input

`HTMLAppElement` forwards pointer, wheel and key events to its client in
surface coordinates computed from its own layout and transform: the same
mapping `measure.ts` and `element-transform.ts` compute in script, done where
the transform is known exactly. The cancelable focus events stay as they are.

### Chords are the engine's

```ts
domicile.grabShortcut("Meta+Shift+l");
domicile.addEventListener("shortcut", (event) => event.chord); // "Meta+Shift+l"
```

`DomicileHost` resolves the chord against the keys `shell_config` carries,
re-resolves it when the layout changes, and dispatches `shortcut` with the
chord for a press in a `<webview>` or on the page itself, taking the latter
from the page. `shell_config` stops reaching the page. Modes stay the shell's:
a pure `@domicile-desktop/sdk/keybindings` helper maps a chord in a mode to an
action.

### The SDK is types and helpers

| Module | Kind |
|---|---|
| `domicile-host` | types: `DomicileHost`, its events, and `Window.domicile` |
| `shell` | type: `Shell` |
| `app-element`, `webview-element` | types |
| `keybindings`, `key-action`, `own-keybindings` | pure helpers: chord grammar, modes |
| `matrix`, `cursor-shape`, `theme`, … | pure helpers |

`domicile-client`, `connect-to-host`, `register-elements`, `desktop-size`,
`device-pixel-ratio`, `host-message`, `bind-keys`, `measure`,
`element-transform`, `surface-coordinates`, `pointer-input` and
`keyboard-input` are deleted. `protocol`, `chrome-message`, `newline-frames`
and `host-stream` move to `@domicile-desktop/e2e-harness`, their only user.

## Key decisions

- **Attributes plus a bare `change` event, over events that carry the new
  value.** The attribute is the one source of truth, and an event's payload
  would be a second copy. This is the platform's own pattern
  (`navigator.onLine` with `online`/`offline`, `screen.orientation` with
  `change`).
- **The engine holds moment events, over a client-side buffer.** The browser
  process is the only place that knows whether a listener exists before it
  dispatches.
- **The new surface lands beside the old, then one step moves every shell.**
  Each engine step adds attributes and events and keeps the ones they replace,
  so `DomicileClient` and the shells keep working untouched; the last step
  rewrites the three shells onto `window.domicile` and deletes the old events
  and the client together. No compatibility layer outlives that step.
- **The do-nothing stand-in goes.** `window.domicile` is optional in the
  types, and a shell opened in a plain browser checks for it. Styling a shell
  without a desktop is the dev server's concern.

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
- [ ] `<app>` routes its own input; `registerElements` and the routing modules go
- [ ] the shells, `examples/minimal-shell`, WRITING-A-SHELL.md and the SDK
      README move to `window.domicile`; `bindKeys` becomes a pure helper over
      `grabShortcut` and `shortcut`, and `shell_config` leaves the page; the
      events the attributes replace
      (`appappeared` and the other seven `app*`, `focuschanged`, …),
      `DomicileClient` and `connect-to-host` go; the wire modules move to
      `e2e-harness`

## Open questions

- **Types from the IDL, or by hand?** `domicile-host.ts` mirrors the IDL by
  hand today. Recommendation: by hand until the surface settles, then generate
  from the `.idl` files.
