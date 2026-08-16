# Domicile

A Wayland compositor whose **renderer is a web engine**. All user chrome is
web content; application windows are real Wayland clients composited *inside*
the web engine as texture-backed DOM elements — so `<app>` supports the same
CSS as `<div>`/`<webview>` (rounding, opacity, blur, transforms, z-index).

> Think "the compositor *is* the browser," not "an Electron app that wraps a
> compositor." See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the why.

## Status

A runnable end-to-end prototype exists: a headless Wayland compositor + an
Electron chrome window, wired so a **real Wayland client appears — with its live
pixels — as a styled `<app>` element in the web chrome**. The compositor copies
each client buffer to RGBA and streams it to the chrome, which draws it into the
`<domicile-app>` canvas (clients keep animating via frame callbacks). The remaining
work is making that zero-copy via engine external textures / CEF
([docs/CEF-SPIKE.md](docs/CEF-SPIKE.md)). See [ROADMAP.md](ROADMAP.md).

## Run the prototype

Needs a display (for the Electron window) + the full shell:

```sh
nix develop .#full -c ./scripts/run-prototype.sh
```

That starts Domicile's headless Wayland compositor and the Electron chrome window.
Then, in another terminal, put an app onto Domicile's display:

```sh
nix develop .#full
XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
```

A rounded/blurred `<app>` portal appears in the chrome window.

App windows are **interactive**: clicking an `<app>` focuses it, and keyboard +
pointer input over it are forwarded to the Wayland client (surface-local coords,
evdev keycodes).

**Keybindings** (in the demo shell, with the chrome window focused):
- **Alt+Enter** — launch a terminal (`kitty`) onto Domicile. GPU/dmabuf-only clients
  may not show pixels until the dmabuf path lands, but input works for any client
  that runs; `wl_shm` clients (e.g. `weston-flower`) show pixels today.
- **Alt+Shift+Enter** — open a `<webview>` pointing at Google (rendered by the
  engine directly; works today).

The message plane (Wayland client → compositor → host brain → chrome) is also
covered by headless, reproducible checks that run without a display:

```sh
nix develop .#full -c ./scripts/e2e-chrome.sh      # message plane (mock chrome)
nix develop .#full -c ./scripts/e2e-electron.sh    # full path incl. the real Electron renderer, under Xvfb
nix develop .#full -c ./scripts/e2e-spawn.sh       # a chrome `spawn` message launches a client
nix develop .#full -c ./scripts/e2e-input.sh       # forwarded keyboard + pointer input reaches a client
```

`e2e-electron.sh` runs the actual Electron chrome headlessly and confirms it
connects, handshakes, and mounts a `<domicile-app>` (reporting its geometry back)
when a real Wayland client maps a window.

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
| `crates/dm-config`   | config schema, parsing, hot-reload, chrome-package resolution | core |
| `crates/dm-scene`    | portal registry, hit-testing, input routing | core |
| `crates/dm-protocol` | host ↔ in-page bridge messages | core |
| `crates/dm-host`     | orchestrator brain + host↔chrome IPC seam | core |
| `crates/domicile`        | host daemon: boots from config, serves the chrome protocol | core |
| `crates/dm-bridge`   | AppTextureBridge bookkeeping (app → engine texture) | core |
| `crates/dm-compositor` | headless Smithay Wayland server driving the brain | `.#full` |
| `chrome-sdk`         | `<domicile-app>` / `<domicile-webview>` custom elements + bridge client | node |
| `shells/simple`      | minimal reference chrome | node |

The Smithay backend is excluded from the default workspace build; build/run it in
the full shell:

```sh
nix develop .#full -c cargo build -p dm-compositor
nix develop .#full -c ./scripts/smoke-compositor.sh   # boots it; a real client binds our globals
```

The GPU-dependent AppTextureBridge proof (one rounded/blurred/rotated `<app>`)
is a runbook you execute on your hardware: [docs/CEF-SPIKE.md](docs/CEF-SPIKE.md).
