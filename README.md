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
([docs/architecture/WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md)). See [ROADMAP.md](ROADMAP.md).

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

An `<app>` portal appears in the chrome window, with a tab for it in the shell's
tab rail.

App windows are **interactive**: clicking an `<app>` focuses it, and keyboard +
pointer input over it are forwarded to the Wayland client (surface-local coords,
evdev keycodes).

The demo shell shows one window at a time and switches between them from the
rail of tabs down its left edge. The rail launches new ones:

- **Terminal** (or **Alt+Enter**) — launch a terminal (`kitty`) onto Domicile.
  GPU clients render through the `zwp_linux_dmabuf_v1` path (their buffer is
  imported into an offscreen GLES context), `wl_shm` clients through the
  shared-memory one.
- **+** (or **Alt+Shift+Enter**) — open a browser window: a `<webview>` the
  engine renders directly, under an address bar with back / forward / stop /
  reload.

The message plane (Wayland client → compositor → host brain → chrome) is also
covered by headless, reproducible checks that run without a display:

```sh
nix run github:cprussin/domicile#measure-round-trip  # what a keystroke costs, end to end
nix run github:cprussin/domicile#e2e-chrome      # message plane (mock chrome)
nix run github:cprussin/domicile#e2e-electron    # full path incl. the real Electron renderer, under Xvfb
nix run github:cprussin/domicile#e2e-no-compositor # a shell that cannot reach the compositor says so once and stops
nix run github:cprussin/domicile#e2e-spawn       # a chrome `spawn` message launches a client
nix run github:cprussin/domicile#e2e-input       # forwarded keyboard + pointer input reaches a client
nix run github:cprussin/domicile#e2e-dmabuf      # the dmabuf global; with a GPU, a real GPU client's frames
nix run github:cprussin/domicile#e2e-slow-chrome # a chrome that stops reading must not freeze the compositor
```

`e2e-dmabuf` is the one that wants real hardware: without a DRM render node it
checks that the global is advertised and stops there, since no client can
allocate a GPU buffer to import. Like the other checks it is headless — no
window appears, because there is no chrome and no output; `prototype` is the
one that opens a window.

To run an *unmerged branch* this way, name it with `?ref=` (branch names contain
slashes, which the `owner/repo/ref` form cannot express) and pass `--refresh`.
Without it Nix re-resolves a branch ref only once an hour, so a branch that was
just force-pushed silently runs the revision you already had:

```sh
nix run --refresh 'github:cprussin/domicile?ref=some/branch#e2e-dmabuf'
```

Each is one of the flake's apps — `prototype` (the default), `e2e-chrome`,
`e2e-electron`, `e2e-no-compositor`, `e2e-spawn`, `e2e-input`, `e2e-dmabuf`,
`e2e-slow-chrome`, `smoke-compositor` — and each runs the matching script under
`scripts/`. From a checkout, run that script yourself:
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
| `packages/component-library` | React UI primitives + the Panda CSS design system every chrome package extends | bun |
| `packages/test-support` | shared bun test setup (happy-dom + jest-dom matchers + RTL cleanup) | bun |
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
is a plan you execute on your hardware: [docs/architecture/WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md).
