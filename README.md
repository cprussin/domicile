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

| Path | What | Build |
|------|------|-------|
| `crates/wc-config`   | config schema, parsing, hot-reload, chrome-package resolution | core |
| `crates/wc-scene`    | portal registry, hit-testing, input routing | core |
| `crates/wc-protocol` | host ↔ in-page bridge messages | core |
| `crates/wc-host`     | orchestrator brain + host↔chrome IPC seam | core |
| `crates/loom`        | host daemon: boots from config, serves the chrome protocol | core |
| `crates/wc-bridge`   | AppTextureBridge bookkeeping (app → engine texture) | core |
| `crates/wc-compositor` | headless Smithay Wayland server driving the brain | `.#full` |
| `chrome-sdk`         | `<loom-app>` / `<loom-webview>` custom elements + bridge client | node |
| `shells/simple`      | minimal reference chrome | node |

The Smithay backend is excluded from the default workspace build; build/run it in
the full shell:

```sh
nix develop .#full -c cargo build -p wc-compositor
nix develop .#full -c ./scripts/smoke-compositor.sh   # boots it; a real client binds our globals
```

The GPU-dependent AppTextureBridge proof (one rounded/blurred/rotated `<app>`)
is a runbook you execute on your hardware: [docs/CEF-SPIKE.md](docs/CEF-SPIKE.md).
