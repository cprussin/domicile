# Loom

A Wayland compositor whose **renderer is a web engine**. All user chrome is
web content; application windows are real Wayland clients composited *inside*
the web engine as texture-backed DOM elements — so `<app>` supports the same
CSS as `<div>`/`<webview>` (rounding, opacity, blur, transforms, z-index).

> Think "the compositor *is* the browser," not "an Electron app that wraps a
> compositor." See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the why.

## Status

Early. The pure-logic core is being built test-first; the graphics/engine
bridge is the next spike. See [ROADMAP.md](ROADMAP.md).

## Develop

Nothing needs to be installed globally — Nix pins the toolchain.

```sh
# Core shell: build & test the pure-logic crates (fast, no GPU needed)
nix develop
cargo test

# Full shell: adds Wayland/DRM/GL libs for the host + CEF bridge
nix develop .#full
```

## Layout

| Path | What |
|------|------|
| `crates/wc-config`   | config schema, parsing, hot-reload, chrome-package resolution |
| `crates/wc-scene`    | portal registry, hit-testing, input routing |
| `crates/wc-protocol` | host ↔ in-page bridge messages |
| `crates/wc-host`     | Smithay Wayland server (later) |
| `crates/wc-bridge`   | CEF embedding + AppTextureBridge (later) |
| `chrome-sdk`         | `<app>` / `<webview>` custom elements (later) |
| `shells/simple`      | minimal reference chrome (later) |
