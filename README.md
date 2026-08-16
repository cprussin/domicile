# Domicile

A Wayland compositor whose **renderer is a web engine**. All user chrome is
web content; application windows are real Wayland clients composited *inside*
the web engine as texture-backed DOM elements — so `<app>` supports the same
CSS as `<div>`/`<webview>` (rounding, opacity, blur, transforms, z-index).

> Think "the compositor *is* the browser," not "an Electron app that wraps a
> compositor." See
> [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) for
> the why.

## Status

A runnable end-to-end prototype exists: a headless Wayland compositor + an
Electron chrome window, wired so a **real Wayland client appears — with its live
pixels — as a styled `<app>` element in the web chrome**. The compositor copies
each client buffer to RGBA and streams it to the chrome, which draws it into the
`<domicile-app>` canvas (clients keep animating via frame callbacks). The remaining
work is making that zero-copy via engine external textures / CEF
([docs/architecture/CEF-SPIKE.md](docs/architecture/CEF-SPIKE.md)). See [ROADMAP.md](ROADMAP.md).

## Run the prototype

Nothing to clone and nothing to install but Nix — it fetches the repo itself:

```sh
nix run github:cprussin/domicile
```

That starts Domicile's headless Wayland compositor and the Electron chrome window,
so it needs a display. Nix hands the app the source read-only in the store while
the build writes into the tree (cargo's `target/`, bun's `node_modules/`), so the
app first stages the fetched source under `~/.cache/domicile/<revision>` — set
`DOMICILE_RUN_DIR` to put it elsewhere — and builds there. Re-running the same
revision reuses those artifacts; a new one starts clean.

From a checkout, run the script directly instead (it builds in your working tree):

```sh
nix develop .#full -c ./scripts/run-prototype.sh
```

Then, in another terminal, put an app onto Domicile's display:

```sh
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
```

(from a checkout, `nix develop .#full` already has `weston-flower` on `PATH`).

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
nix run github:cprussin/domicile#e2e-chrome      # message plane (mock chrome)
nix run github:cprussin/domicile#e2e-electron    # full path incl. the real Electron renderer, under Xvfb
nix run github:cprussin/domicile#e2e-spawn       # a chrome `spawn` message launches a client
nix run github:cprussin/domicile#e2e-input       # forwarded keyboard + pointer input reaches a client
```

Each is one of the flake's apps — `prototype` (the default), `e2e-chrome`,
`e2e-electron`, `e2e-spawn`, `e2e-input`, `smoke-compositor` — and each runs the
matching script under `scripts/`. From a checkout, run that script yourself:
`nix develop .#full -c ./scripts/e2e-chrome.sh`, and so on.

`e2e-electron.sh` runs the actual Electron chrome headlessly and confirms it
connects, handshakes, and mounts a `<domicile-app>` (reporting its geometry back)
when a real Wayland client maps a window.

## Develop

Nothing needs to be installed globally — Nix pins both toolchains. (Without a
checkout, `nix develop github:cprussin/domicile` and
`nix develop github:cprussin/domicile#full` give you the same two shells.)

```sh
# Core shell: the pure-logic crates plus the whole TypeScript workspace
nix develop

cargo test                     # Rust: the crates in `default-members`
bun run turbo test             # TypeScript: lint, types, unit tests, shell build

# Full shell: adds Wayland/DRM/GL libs for the compositor + CEF bridge
nix develop .#full
```

Before opening a PR, run both, plus `cargo fmt --all --check` and
`cargo clippy --all-targets -- -D warnings`. `bun run turbo fix` applies the
auto-fixable half of the TypeScript checks. See
[docs/guidelines/WORKSPACE.md](docs/guidelines/WORKSPACE.md) and
[docs/guidelines/RUST.md](docs/guidelines/RUST.md) for the full workflow, and
[AGENTS.md](AGENTS.md) for the code guidelines every change is held to.

## Layout

| Path | What | Build |
|------|------|-------|
| `packages/domicile-config`   | config schema, parsing, hot-reload, chrome-package resolution | core |
| `packages/domicile-scene`    | portal registry, hit-testing, input routing | core |
| `packages/domicile-protocol` | host ↔ in-page bridge messages | core |
| `packages/domicile-host`     | orchestrator brain + host↔chrome IPC seam | core |
| `packages/domicile`        | host daemon: boots from config, serves the chrome protocol | core |
| `packages/domicile-bridge`   | AppTextureBridge bookkeeping (app → engine texture) | core |
| `packages/domicile-compositor` | headless Smithay Wayland server driving the brain | `.#full` |
| `packages/chrome-sdk` | `<domicile-app>` / `<domicile-webview>` custom elements + bridge client | bun |
| `packages/test-support` | shared bun test setup (happy-dom + jest-dom matchers) | bun |
| `packages/e2e-harness` | headless chrome stand-ins driving the `scripts/e2e-*.sh` checks | bun |
| `apps/shell`         | the bundled reference chrome (Electron host + Vite-built renderer) | bun |

Both languages share one package tree: a package under `packages/` is a cargo
crate when it carries a `Cargo.toml` and a bun workspace when it carries a
`package.json`. The TypeScript half is orchestrated by turbo, linted by biome,
and typed against the `@cprussin/tsconfig` presets — the same setup as the
sibling `argo-browser` repo.

The Smithay backend is excluded from the default workspace build; build/run it in
the full shell:

```sh
nix develop .#full -c cargo build -p domicile-compositor
nix develop .#full -c ./scripts/smoke-compositor.sh   # boots it; a real client binds our globals
```

Without a checkout, the smoke test is `nix run github:cprussin/domicile#smoke-compositor`.

The GPU-dependent AppTextureBridge proof (one rounded/blurred/rotated `<app>`)
is a runbook you execute on your hardware: [docs/architecture/CEF-SPIKE.md](docs/architecture/CEF-SPIKE.md).
