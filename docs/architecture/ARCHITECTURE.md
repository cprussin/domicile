# Domicile architecture

Domicile is a Wayland compositor whose **renderer is a web engine**. All user
chrome (panels, launchers, window decorations, overlays — everything that
isn't an application window) is rendered as web content. Application windows
are real Wayland clients whose surfaces are composited *inside the web engine*
as texture-backed DOM elements, so they inherit the full CSS pipeline
(rounding, opacity, blur, transforms, z-index) exactly like a `<video>`.

## The core idea

The only thing a normal web engine can't do out of the box is *"let a custom
element be backed by an external application's GPU surface."* But engines
already composite external GPU textures as elements — that's how `<video>`,
`<canvas>`, WebGL, and WebGPU work. So an app window is just **another
external-texture source** fed into a pathway the engine already has:

- `<app id="wayland-id">` — a replaced element backed by a Wayland client's
  surface (dmabuf/GL texture). Full CSS applies.
- `<webview src="…">` — a replaced element backed by a nested browsing context.

This is why we do **not** fork the engine. We embed a *prebuilt* engine and
add a thin bridge that hands app surfaces to the page.

## Decisions (and why)

### Engine: prebuilt Chromium via CEF — a layer, not a fork
- **Full Chrome CSS/JS fidelity** ("everything a `<div>` supports").
- **Fast builds**: link a prebuilt CEF binary distribution (~1 GB); we compile
  only our own code (minutes), never Chromium itself (would be hours).
- **Layer, not fork**: the app-surface capability reuses Chromium's existing
  external-texture compositing rather than patching its guts.
- Cost: CEF is C/C++, driven from Rust over FFI. We don't maintain Chromium.

Alternatives considered: **Servo/WebRender** (pure Rust, but web-platform
coverage is a subset of Chromium — rejected because we don't want to trade
functionality); **hard-fork Chromium** (full fidelity but multi-hour builds
and heavy fork maintenance — rejected); **WPE WebKit** (capable, embeddable,
but C/C++ and no advantage over CEF for our purposes).

### Wayland host: Rust + Smithay
- Memory-safe, modern, and its core (scene, input routing, portal geometry,
  config) is **pure logic that unit-tests cleanly** — essential for TDD.
- `winit` backend runs the whole compositor *nested inside a window* for dev
  and tests, so we don't need DRM/KMS hardware to iterate.

### One chrome page spanning every display, not one window per display

The desktop is a list of displays in the config, one `wl_output` each, and one
page across all of them. A display is a *region* of that page, which the shell
addresses with `<Screen name="left">`.

The rejected alternative is worth stating, because it looks like the obvious
one. A chrome window is two connections — a host-protocol connection the
preload opens per renderer, and a Wayland client, which is the whole engine
process with N toplevels on it — and nothing correlates them. Every way of
naming which display a toplevel is on fails or costs: the `xdg_toplevel` title
is set by the page and identical for every window (and arrives after the
output is entered anyway), `app_id` is process-wide, and a chrome socket per
display works at the price of one engine process per monitor.

Beyond naming, N pages means N copies of the shell's state, each with its own
window list disagreeing with the others. It also needs portal ownership per
app, unicast frames, display identity on every request, and shortcuts
delivered to one connection rather than fired N times.

What one page costs is mixed density: it rasterises at a single
`devicePixelRatio`, the maximum of the outputs its toplevel entered, so on a
desktop of unequal scales one screen is drawn for the other's. `<Screen>` is
the seam — a shell written against it compiles unchanged if this is
revisited — so the decision is reversible without touching shell code.

### Dev environment: Nix flake
- Nothing is installed globally; Nix pins the whole toolchain reproducibly.
- `nix develop` → core (Rust) shell; `nix develop .#full` adds Wayland/DRM/GL.

## Process & data-flow shape

```
┌──────────────────────────────────────────────────────────────┐
│ Rust host  (Smithay)                                           │
│  • Wayland server: accepts app clients, exports their surfaces  │
│    as GPU textures (dmabuf)                                     │
│  • libinput input; DRM/KMS presentation (or nested winit)      │
│  • config load + hot-reload; resolves the active chrome package │
│                          │ app dmabuf                          │
│                          ▼                                      │
│  AppTextureBridge (FFI)  ── hands app surfaces to the page      │
│                          │                                      │
│  Chromium (prebuilt, via CEF)                                   │
│   • chrome = a web page (full CSS/JS)                           │
│   • <app>     → element backed by an app's surface texture      │
│   • <webview> → CEF browsing context                           │
│   • renders ONE composited GPU frame ──► host scans it out      │
│                          ▲                                      │
│  input routing: host hit-tests via the page's layout;          │
│   pointer over an <app> → transform coords → deliver to client;  │
│   otherwise → deliver to the page                              │
└──────────────────────────────────────────────────────────────┘
```

## Crate layout

Pure-logic crates, in `cargo`'s default set — `cargo test` builds and runs these
without a GPU, an engine or Smithay:
- `domicile-config`  — config schema, parsing, hot-reload semantics, chrome-package
  resolution.
- `domicile-scene`   — portal registry (app_id → geometry/transform), hit-testing,
  input routing. Pure geometry/logic.
- `domicile-protocol`— message types shared between the host and the in-page bridge
  client (portal geometry, input, lifecycle).
- `domicile-host`    — the orchestrator brain: what the compositor asks where to
  deliver input and what to tell the chrome. Pure logic, no Wayland.
- `domicile`         — the host daemon: boots from config and serves the chrome
  protocol.
- `domicile-bridge`  — AppTextureBridge bookkeeping (app → engine texture), for
  the load-bearing spike: one Wayland client rendering as a CSS-styled element,
  zero-copy.

Excluded from the default set, because it pulls Smithay and the native Wayland
libraries — build it in `nix develop .#full`:
- `domicile-compositor` — the headless Smithay Wayland server that drives the
  brain. `cargo build -p domicile-compositor`.

Web side:
- `packages/chrome-sdk` — TypeScript: the `<app>`/`<webview>` custom elements + bridge client.
- `packages/shell-manganese` — the bundled reference chrome.
- `packages/shell-simple` — the smallest chrome that works, for reading rather than using.

## Testing strategy (TDD)

Value concentrates in the pure-logic core, so that's where tests lead:
- **domicile-config**: parsing (valid/invalid), defaults, chrome-ref resolution,
  and the hot-reload rule *"on parse error, keep last-good config and surface
  the error"* (never crash the compositor on a bad edit).
- **domicile-scene**: hit-testing under transforms, z-order resolution, input
  routing between chrome and apps.
- **domicile-protocol**: round-trip (de)serialization and version negotiation.

Hardware-facing glue (DRM/KMS, CEF FFI) is kept thin and validated with
nested/integration runs rather than unit tests.
