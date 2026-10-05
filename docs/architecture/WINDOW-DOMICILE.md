# `window.domicile` is the API

Proposal: a shell uses `window.domicile` directly, with no setup.

- The engine reports the desktop's size and density.
- `<app>` routes its own input.
- The engine resolves key chords.
- `@domicile-desktop/sdk` ships only types and pure helpers.
- `DomicileClient` is deleted.

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
  domicile.addEventListener("windowschange", show);
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

Each value with a current state is a readonly attribute on `DomicileHost`. A
change dispatches `<name>change` with no payload. A shell reads the attribute,
then subscribes. A late listener misses nothing, so no buffering is needed.

| Attribute | Replaces |
|---|---|
| `windows: DomicileWindow[]` | `appappeared`, `appclosed`, `appresized`, `apptitled`, `appminsize`, `appmaxsize`, `appcursor`, `popupplaced` |
| `focusedWindow: string \| null` | `focuschanged` |
| `displays` | already an attribute; add `displayschange` |
| `theme`, `windowsTheme` | `theme`, `windowstheme` |
| `locked`, `idle` | `locked`, `idle` |
| `extensions`, `tray`, `notifications`, `clipboard` | events of the same names |
| `modifiers` | `modifiers` |

`DomicileWindow` uses optional fields in place of the IDL's `hasSize` and empty
strings: `size?: { width, height }`, `title`, `minSize?`, `maxSize?`, `cursor`,
`popup?: { parent, x, y, grab }`.

### One-off events are queued by the engine

`focusrequested`, `shortcut` and `audiolevels` have no current value. The engine queues each event type until its first listener attaches,
then delivers the queue. This replaces `DomicileClient.#held`.

### Requests return promises

`searchFiles`, `previewFile` and `searchApps` resolve with their result. The
`files`, `filepreview` and `apps` events go. A newer call rejects the pending
one with `AbortError`.

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

- The browser process already holds the keymap (`ControlChannel`'s
  `KeymapSink`). It resolves each chord and re-resolves on layout change.
- `shell_config` no longer reaches the page.
- Modes stay in the shell. A pure `@domicile-desktop/sdk/keybindings` helper
  maps a chord in a mode to an action.

### The SDK is types and helpers

| Module | Kind |
|---|---|
| `domicile-host` | types: `DomicileHost`, its events, `Window.domicile` |
| `shell` | type: `Shell` |
| `app-element`, `webview-element` | types |
| `keybindings`, `key-action`, `own-keybindings` | pure helpers: chord grammar, modes |
| `matrix`, `cursor-shape`, `theme`, … | pure helpers |

- Deleted: `domicile-client`, `connect-to-host`, `register-elements`,
  `host-message`, `bind-keys`, `measure`, `element-transform`,
  `surface-coordinates`, `pointer-input`, `keyboard-input`.
- Moved to `@domicile-desktop/e2e-harness`, their only user: `protocol`,
  `chrome-message`, `newline-frames`, `host-stream`.

## Key decisions

- **Battery, brightness and audio are not attributes.** They become libraries
  on the system primitives in [SYSTEM-ACCESS.md](SYSTEM-ACCESS.md).

- **Attributes plus a bare change event, over events carrying the value.** The
  attribute is the single source of truth. This matches the platform
  (`navigator.onLine` with `online`/`offline`, `screen.orientation` with
  `change`).
- **The engine queues one-off events, over a client-side buffer.** Only the
  browser process knows whether a listener exists at dispatch time.
- **No compatibility layer.** The only users are the three shells in this
  repo. Each step changes the IDL, the SDK and every shell together.
- **No stand-in object in a plain browser.** `window.domicile` is optional in
  the types, and a shell checks for it. Styling a shell without a desktop is
  the dev server's job.

## Plan

Each step ships alone, engine and shells together.

- [x] the engine reports size and density (`guard-desktop-geometry.sh`)
- [ ] `windows` and `focusedWindow` with their change events; the eight `app*`
      events and `focuschanged` go
- [ ] the rest of the state as attributes: `displays`, theme, lock, idle,
      extensions, tray, notifications, clipboard, modifiers
- [ ] the engine queues one-off events until a listener exists
- [ ] search and preview return promises
- [ ] the engine resolves chords; `shell_config` leaves the page; `bindKeys`
      becomes a pure helper over `grabShortcut` and `shortcut`
- [ ] `<app>` routes its own input; `registerElements` and the routing modules
      go
- [ ] `DomicileClient` and `connect-to-host` go; the wire modules move to
      `e2e-harness`; the shells, `examples/minimal-shell`, WRITING-A-SHELL.md
      and the SDK README describe `window.domicile`

## Open questions

- **Types from the IDL, or by hand?** `domicile-host.ts` mirrors the IDL by
  hand. Recommendation: by hand until the API settles, then generate from the
  `.idl` files.
