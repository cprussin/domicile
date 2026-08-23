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

Pure-logic crates (built & tested now, no GPU/engine needed):
- `domicile-config`  — config schema, parsing, hot-reload semantics, chrome-package
  resolution.
- `domicile-scene`   — portal registry (app_id → geometry/transform), hit-testing,
  input routing. Pure geometry/logic.
- `domicile-protocol`— message types shared between the host and the in-page bridge
  client (portal geometry, input, lifecycle).

Hardware/engine crates (join via `nix develop .#full`):
- `domicile-host`    — Smithay Wayland server, output, input, presentation.
- `domicile-bridge`  — CEF embedding + AppTextureBridge (the load-bearing spike:
  prove one Wayland client rendering as a CSS-styled element, zero-copy).

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
