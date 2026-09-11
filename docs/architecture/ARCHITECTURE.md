# Domicile architecture

Domicile is a Wayland compositor whose **renderer is a web engine**. All user
chrome — panels, launchers, window decorations, overlays, everything that is not
an application window — is web content. An application window is a real Wayland
client whose surface is composited *inside* the engine as an element, so it
inherits the whole CSS pipeline: rounding, opacity, blur, transforms, z-index,
exactly as a `<video>` does.

## The core idea

An engine already composites external GPU textures as elements — that is how
`<video>`, `<canvas>`, WebGL and an out-of-process `<iframe>` work. An app
window is another external-texture source fed into a pathway the engine has:

- `<app app-id="…">` — a window belonging to a Wayland client, laid out by the
  page. Its layout box is the client's `xdg_toplevel.configure`.
- `<webview src="…">` — a nested browsing context.

Both are elements the engine defines. A shell written against them does not run
in stock Chrome, which is the accepted cost of the tag being `<app>`.

## Decisions, and why

### The engine is a fork, and `<app>` is a `cc::SurfaceLayer`

The compositor submits a client's dmabuf into a viz surface; `<app>` embeds that
surface with a `cc::SurfaceLayer`, which is a plain `cc::Layer` and goes into
the page's property trees with every other layer. CSS is therefore *structural*
rather than reimplemented: the page's own compositor applies z-index, transform,
clip, opacity, filter and blend to a window because it applies them to a layer.

The alternative was to keep a prebuilt engine and reach the same effect from
outside it, which is what this project tried first and what
`STACKING-PARITY.md` measured: an unforked engine will not emit its layer tree,
so the page arrives as one flat raster and a window can only be interleaved into
it by splitting the chrome into bands — which imposes a `data-band` attribute on
every painting element, and so fails the CSS-parity and shell-simplicity
requirements the project exists for.

A fork costs rebases and a four-hour build. What makes it affordable is that it
is mostly *new* files against a pinned revision, and new files do not conflict:
21 of Chromium's own are edited, 15 of them Blink's, and eleven of those went on
defining `<app>` and `<webview>` as real elements.
[ENGINE-FORK.md](ENGINE-FORK.md) is the design, the series and the
measurements.

### Wayland host: Rust + Smithay

The compositor is a Wayland server and nothing else draws for it. Smithay
supplies the protocol machinery; the interesting half — scene, input routing,
portal geometry, config — is pure logic that unit-tests without a GPU, an engine
or a display, which is what makes test-first work here.

### One chrome page spanning every display, not one window per display

The desktop is a list of displays in the config, one `wl_output` each, and one
page across all of them. A display is a *region* of that page, which a shell
addresses with `<Screen name="left">`.

The rejected alternative is worth stating, because it looks like the obvious
one. Nothing correlates a chrome's toplevels with the displays they are on: the
`xdg_toplevel` title is set by the page and identical for every window, and
arrives after the output is entered anyway; `app_id` is process-wide; a chrome
socket per display works at the price of one engine process per monitor. Beyond
naming, N pages means N copies of the shell's state, each with a window list
disagreeing with the others, plus portal ownership per app, unicast frames,
display identity on every request, and shortcuts delivered once rather than
fired N times.

What one page costs is mixed density: it rasterises at a single
`devicePixelRatio`, the maximum of the outputs its toplevel entered, so on a
desktop of unequal scales one screen is drawn for the other's. `<Screen>` is the
seam — a shell written against it compiles unchanged if this is revisited — so
the decision is reversible without touching shell code.

### Dev environment: Nix flake

Nothing is installed globally; Nix pins the toolchain. `nix develop` is the core
Rust and Node shell; `nix develop .#full` adds Wayland, Mesa and the GL stack.

## Shape

```
  wayland client ──dmabuf──▶ domicile-compositor ──CompositorFrame──▶ viz ──┐
                             (Smithay server,                               │
                              viz producer)                                 │ aggregates
                                                                            ▼
  the shell's page: <app> ──SurfaceLayer(SurfaceId)──▶ cc layer tree ──▶ viz ┴─▶ display
```

The page and the compositor meet at a `viz::SurfaceId` and nowhere else. The
page never sees a pixel of the window; the compositor never sees the page's
layout.

Input runs the other way. The engine delivers pointer and keyboard events to the
page; the page reports what is under a pointer and which window has focus; the
compositor routes to the client's seat accordingly.

The page reaches the compositor through `navigator.domicile`, which the fork
binds on the shell's origin and the browser process carries to the compositor's
control socket. The engine serves the shell over `domicile://`, so nothing has
to be told where the session is and nothing binds a port.

`domicile` is what starts the two, in the one order they can start in: the
engine first, because it serves the shell and creates the broker socket; then
the compositor, which connects to it as a producer. It builds nothing — both
ship beside it and it finds them from its own path.

## Crate layout

Pure logic, in cargo's default set — `cargo test` builds and runs these without
a GPU, an engine or Smithay:

- `domicile-config` — config schema, parsing, hot reload, shell resolution.
- `domicile-scene` — portal registry, hit-testing, input routing, z-order.
- `domicile-protocol` — the messages the page and the compositor exchange, and
  version negotiation.
- `domicile-host` — the orchestrator brain: where input goes and what the chrome
  is told. No Wayland.
- `domicile-launch` — `domicile` itself: which page to serve, which ozone
  platform, where the two components are, and what each is started with. The
  binary that reads the world is ninety lines; everything with a decision in it
  is a module here.
- `domicile-test-chrome`, `domicile-test-client` — a chrome and a Wayland
  client the integration tests drive, as libraries so their own behaviour is
  testable without Smithay.

Outside the default set, because it pulls Smithay and the native Wayland
libraries — build it in `nix develop .#full`:

- `domicile-compositor` — the Wayland server itself, and the seam to the engine.

Web side:

- `packages/chrome-sdk` — the shell-facing API: elements, the client for
  `navigator.domicile`, measurement, input.
- `packages/component-library` — the shared components and the Panda preset.
- `packages/shell-manganese` — the reference desktop.
- `packages/shell-simple` — a desktop with nothing in it but windows.
  `examples/minimal-shell` is smaller still and is the worked example in
  `docs/WRITING-A-SHELL.md`.
- `packages/e2e-harness`, `packages/test-support` — the fixtures the end-to-end
  scripts and the DOM suites run against.

## Testing

Value concentrates in the pure-logic core, so that is where tests lead: config
parsing and the keep-last-good rule on a bad edit, hit-testing under transforms,
routing between chrome and apps, protocol round-trips and version negotiation.

Hardware-facing glue is kept thin and checked by the e2e scripts and the engine
job on `crux`, which is the only thing that builds the fork and drives the pixel
guards. `docs/guidelines/TESTING.md` is how to write them.
