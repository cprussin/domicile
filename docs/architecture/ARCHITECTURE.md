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
the series carries 133 files of its own under `packages/domicile-engine/src`
and edits 78 of Chromium's, 23 of those a `BUILD.gn`, a `.gni` or a `.json5`
list that a new file has to be named in. Recount them rather than quoting this
— the number grew with the Ozone DRM port and will grow again.
[ENGINE-FORK.md](ENGINE-FORK.md) is the design, the series and the
measurements.

### Wayland host: Rust + Smithay

The compositor is a Wayland server and nothing else draws for it. Smithay
supplies the protocol machinery; the interesting half — scene, input routing,
portal geometry, config — is pure logic that unit-tests without a GPU, an engine
or a display, which is what makes test-first work here.

### A page per display where the engine scans out, one page everywhere else

The desktop is a list of displays — the config's, or the monitors DRM
reports — one `wl_output` each. A display is a *region* of a page, which a
shell addresses with `<Screen name="left">`, and how many pages there are is
the platform's answer rather than the shell's.

**Nested, one page spans every display.** A region is a part of it, and a shell
lays out the whole desk in one window.

**On a tty, a page IS one display**, because `ScreenManager::FindWindowAt`
binds a window to a display controller only on an exact rectangle match and one
window cannot be two rectangles. The engine opens a browser window per CRTC and
each loads the same shell; each is told the whole desk with its own display
marked — `as_seen_from` in `domicile-host` — so a `<Screen>` renders in the
window on the monitor it names and nowhere else. `<Screen>` is the seam either
way: a shell written against it compiles unchanged, which is what made this
reversal cost no shell code.

What one page across a desk costs is mixed density: it rasterizes at a single
`devicePixelRatio`, so on a desktop of unequal scales one screen is drawn for
the other's. A page per display does not have that problem and has another: N
pages are N copies of a shell's state, and keeping them one desktop is the
shell's to arrange — `shell-manganese` reduces on the page covering the first
screen and the others ask it to. The compositor is unaffected either way; the
`Host` is one brain with a window each, and `set_screen` is the only message
whose answer differs per connection.

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

The page reaches the compositor through `window.domicile`, which the fork
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
  `[[bin]]` is only the part that reads the world and starts things; everything
  with a decision in it is a module here, tested against strings and a temp
  directory.
- `domicile-test-chrome`, `domicile-test-client` — a chrome and a Wayland
  client the integration tests drive, as libraries so their own behavior is
  testable without Smithay.

Outside the default set, because it pulls Smithay and the native Wayland
libraries — build it in `nix develop .#full`:

- `domicile-compositor` — the Wayland server itself, and the seam to the engine.
  Inside it: `screens.rs` is what the desktop is made of; `dmabuf_import.rs` the
  import; `engine.rs`, `engine_session.rs` and `engine_buffers.rs` the seam to
  the fork and what it holds; `outbound.rs` the queue to the chrome; `scale.rs`,
  `viewport.rs`, `coalesce.rs`, `timing_window.rs`, `modifiers.rs` and
  `latency.rs` are each one small thing named after itself.

  `appearance.rs` is the one thing in here that talks to something other than
  the engine, the clients or the chrome: it answers
  `org.freedesktop.impl.portal.Settings` on the session bus, which is where
  every GTK, Qt, Electron and Firefox window on the desk reads its color
  scheme. The chrome hears about a theme over the host protocol because it is a
  page on the end of a socket this process already owns; every other window is
  a Wayland client that has never heard of that socket, and there is no Wayland
  protocol for which way round a desktop is drawn.

  **Two rules the chrome queue is built around, both from freezes.** Never write
  to a chrome from the Wayland loop — a chrome that reads slowly fills the socket
  buffer and a blocking write stops frame callbacks for *every* client. Never
  *wait* on one either: that stalls the thread that injects input, past the 200ms
  repeat delay, so a key the user tapped starts repeating. `outbound.rs` is the
  queue that keeps both, and `message()` never waits and never drops. It gives
  frames no policy of their own, because no frame comes down it: a client's
  buffer goes to the display compositor, so what is left is messages. The freeze
  itself is written down in `tests/input.rs`, where a chrome that stopped
  draining once cost the compositor twenty seconds.

Web side:

- `packages/chrome-sdk` — the shell-facing API: elements, the client for
  `window.domicile`, measurement, input.
- `packages/component-library` — the shared components and the Panda preset.
- `packages/shell-manganese` — the reference desktop.
- `packages/shell-simple` — a desktop with nothing in it but windows.
  `examples/minimal-shell` is smaller still and is the worked example in
  `docs/WRITING-A-SHELL.md`.
- `packages/e2e-harness`, `packages/test-support` — the fixtures the end-to-end
  scripts and the DOM suites run against.

Neither, and in the tree all the same:

- `packages/domicile-engine` — the fork. A Chromium pin, the patch series
  applied on top of it, the guards and spikes that measure it, and the pin of
  the published build the flake fetches. Nothing here builds from this
  checkout; `README.md` there says how to get an engine without spending four
  hours on one.

## Testing

Value concentrates in the pure-logic core, so that is where tests lead: config
parsing and the keep-last-good rule on a bad edit, hit-testing under transforms,
routing between chrome and apps, protocol round-trips and version negotiation.

Hardware-facing glue is kept thin and checked by the e2e scripts and the engine
job on `crux`, which is the only thing that builds the fork and drives the pixel
guards. `docs/guidelines/TESTING.md` is how to write them.
