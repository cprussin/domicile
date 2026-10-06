# Domicile architecture

Domicile is a Wayland compositor that uses a web engine as its renderer.

- All chrome (panels, launchers, decorations, overlays) is web content.
- Each app window is a Wayland client surface drawn inside the engine as an
  element. CSS applies to it like any other element: rounding, opacity, blur,
  transforms, z-index.

## Elements

The engine already draws external GPU textures as elements (`<video>`,
`<canvas>`, WebGL, out-of-process `<iframe>`). Domicile adds two:

- `<app app-id="…">`: a Wayland client's window. Its layout box sets the
  client's `xdg_toplevel.configure` size.
- `<webview src="…">`: a nested browsing context.

A shell that uses these elements does not run in stock Chrome.

## Key decisions

### Forked engine; `<app>` is a `cc::SurfaceLayer`

- The compositor submits a client's dmabuf to a viz surface.
- `<app>` embeds that surface with a `cc::SurfaceLayer`, an ordinary layer in
  the page's property trees.
- The page's compositor applies z-index, transform, clip, opacity, filter and
  blend to the window the same way it does for any layer. Domicile does not
  reimplement CSS.

A fork over a stock engine because a stock engine does not expose its layer
tree. Windows could then only be interleaved by splitting the chrome into
bands, which needs a `data-band` attribute on every painting element. See
[STACKING-PARITY.md](STACKING-PARITY.md).

Cost: rebases and a four-hour build. The series is mostly new files under
`packages/domicile-engine/src`, which do not conflict on rebase. Edits to
Chromium's own files are mostly build lists (`BUILD.gn`, `.gni`, `.json5`).
See [ENGINE-FORK.md](ENGINE-FORK.md).

### Rust and Smithay for the Wayland host

- Smithay provides the Wayland protocol handling.
- Scene, input routing, portal geometry and config are pure logic. They
  unit-test without a GPU, engine or display.

### One page for the whole desktop

- The desktop is a list of displays (from config or from DRM), one `wl_output`
  each.
- A shell is one page covering the desktop's bounding box. Each display is a
  region of it, addressed with `<Screen name="left">`.
- Nested, the page is a window. On a tty, the engine shows it on every monitor
  at that monitor's density and refresh rate.
- The compositor's `Host` sends the same desktop state to every chrome.

See [ONE-PAGE-FOR-THE-DESK.md](ONE-PAGE-FOR-THE-DESK.md).

### Nix flake for the dev environment

- `nix develop`: Rust and Node toolchain.
- `nix develop .#full`: adds Wayland, Mesa and the GL stack.

## Data flow

```
  wayland client ──dmabuf──▶ domicile-compositor ──CompositorFrame──▶ viz ──┐
                             (Smithay server,                               │
                              viz producer)                                 │ aggregates
                                                                            ▼
  the shell's page: <app> ──SurfaceLayer(SurfaceId)──▶ cc layer tree ──▶ viz ┴─▶ display
```

- **Pixels:** the page and the compositor share only a `viz::SurfaceId`. The
  page never sees window pixels. The compositor never sees page layout.
- **Input:** the engine delivers pointer and keyboard events to the page. The
  page reports what is under the pointer and which window has focus. The
  compositor routes events to the client's seat.
- **Control:** the page calls the compositor through the `domicile` handed to
  its `Shell`. The engine makes it when it runs the shell on the shell's
  origin, and forwards calls to the compositor's control socket. See
  [WINDOW-DOMICILE.md](WINDOW-DOMICILE.md).
- **Serving:** the engine serves the shell over `domicile://`, so no port is
  bound. See [DOMICILE-SCHEME.md](DOMICILE-SCHEME.md).

## Startup

The `domicile` binary starts the engine, then the compositor:

1. The engine serves the shell and creates the broker socket.
2. The compositor connects to that socket as a producer.

`domicile` builds neither; it finds both next to its own path. A shell given
as source is built by `domicile-builder`. See
[THE-DOMICILE-BINARY.md](THE-DOMICILE-BINARY.md) and
[COMPOSABLE-SHELLS.md](COMPOSABLE-SHELLS.md).

## Crate layout

Pure logic, in cargo's default members. `cargo test` runs them without a GPU,
engine or Smithay:

- `domicile-config`: config schema, parsing, hot reload, shell resolution.
- `domicile-scene`: portal registry, hit-testing, input routing, z-order.
- `domicile-protocol`: page-compositor messages and version negotiation.
- `domicile-host`: decides where input goes and what the chrome is told. No
  Wayland.
- `domicile-launch`: the `domicile` binary. Decides which page to serve, which
  Ozone platform to use, where the components are and how to start them. The
  `[[bin]]` only does I/O; all decisions live in tested modules.
- `domicile-test-chrome`, `domicile-test-client`: a chrome and a Wayland client
  for integration tests.

Outside the default members (needs Smithay and native Wayland; build in
`nix develop .#full`):

- `domicile-compositor`: the Wayland server and the bridge to the engine.
  - `outbound.rs` queues messages to the chrome. The Wayland thread never
    writes to or waits on a chrome socket; a slow chrome would otherwise stall
    input and frame callbacks for every client.
  - `appearance.rs` serves `org.freedesktop.impl.portal.Settings` on the
    session bus, so GTK, Qt, Electron and Firefox apps follow the desktop's
    color scheme.
  - `eis.rs` serves EIS, the emulated input the RemoteDesktop and
    InputCapture portals hand out. Its input takes the engine's input path,
    so the lock refuses it.

Web side:

- `packages/chrome-sdk`: the shell API (elements, the types of the desktop a
  shell is handed, measurement, input).
- `packages/component-library`: shared components and the Panda preset.
- `packages/domicile-builder`: builds a shell from a user's TS/JS entry.
- `packages/shell-manganese`: the reference desktop.
- `packages/shell-simple`: a desktop with only windows.
- `examples/minimal-shell`: the smallest shell; the worked example in
  [WRITING-A-SHELL.md](../WRITING-A-SHELL.md).
- `packages/e2e-harness`, `packages/test-support`: fixtures for the e2e scripts
  and DOM tests.

Engine:

- `packages/domicile-engine`: the fork. Holds the Chromium pin, the patch
  series, the guards and spikes that measure it, and the pin of the published
  build the flake fetches. Nothing builds from the checkout; its `README.md`
  says how to get a prebuilt engine.

## Testing

- Tests focus on the pure-logic core: config parsing (including keeping the
  last good config on a bad edit), hit-testing under transforms, routing
  between chrome and apps, protocol round-trips and version negotiation.
- Hardware-facing code stays thin. The e2e scripts and the engine job on
  `crux` cover it. `crux` is the only machine that builds the fork and runs
  the pixel guards.
- See [TESTING.md](../guidelines/TESTING.md).
