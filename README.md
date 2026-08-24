# Domicile

A Wayland compositor whose **renderer is a web engine**. All user chrome is web
content; application windows are real Wayland clients composited *inside* the
web engine as texture-backed DOM elements — so `<app>` takes the same CSS as a
`<div>`: rounding, opacity, blur, transforms, z-index.

The compositor *is* the browser, not an Electron app wrapping a compositor.
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) says why.

**Status:** runnable prototype. A real Wayland client appears, with live pixels,
as a styled `<app>` in the web chrome. Frames are still copied buffer → RGBA →
canvas; making that zero-copy is the remaining work
([WINDOW-COMPOSITING.md](docs/architecture/WINDOW-COMPOSITING.md),
[ROADMAP.md](ROADMAP.md)).

## Run it

Needs Nix and a display. Nothing to clone — Nix fetches the repo.

```sh
nix run github:cprussin/domicile                      # manganese, the reference chrome
nix run github:cprussin/domicile#prototype -- simple   # shell-simple
```

- **manganese** ([README](packages/shell-manganese/README.md)) — tab rail, stage,
  address bar. The GUI explains itself.
- **simple** ([README](packages/shell-simple/README.md)) — floating windows and
  nothing else. Worth reading first if you want to know what a shell actually
  has to do.

The argument names a directory under `packages/shell-*`; an unknown one lists
what is there.

From a checkout, run the script directly — it builds in your working tree:

```sh
nix develop .#full -c ./scripts/run-prototype.sh          # manganese
nix develop .#full -c ./scripts/run-prototype.sh simple
```

First run stages the fetched source under `~/.cache/domicile/<revision>` and
builds there (`DOMICILE_RUN_DIR` moves it); re-running the same revision reuses
those artifacts.

## Open an app in it

Both shells start empty.

- **manganese** — the rail's **Terminal** button, or **Alt+Enter**.
- **simple** — **Alt+Enter** opens a terminal (`kitty`). That is the only
  combination it claims.

Everything you start from that terminal lands on Domicile too, since it inherits
the environment. To launch something from outside instead, point any Wayland
client at Domicile's display:

```sh
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=/tmp/domicile-rt WAYLAND_DISPLAY=wayland-1 weston-flower
```

Those two variables are the whole mechanism. There is no XWayland, so an
X11-only client will not connect — it falls back to your own session's display,
which looks like Domicile ignoring it.

Windows are interactive in either shell: clicking one focuses it, and pointer
and keyboard input are forwarded to the client (surface-local coords, evdev
keycodes).

## Checks

Headless and reproducible — no display, no window:

```sh
nix run github:cprussin/domicile#check   # rust + typescript + every e2e script
```

Individual checks run the same way — `#e2e-chrome`, `#e2e-input`, `#e2e-spawn`,
`#e2e-dmabuf`, `#measure-round-trip` and the rest; the `apps` set in
`flake.nix` is the list. Not every script has one, so from a checkout run any
of them directly: `nix develop .#full -c ./scripts/<name>.sh`.

`#e2e-dmabuf` is the only check that wants real hardware; without a DRM render
node it confirms the global is advertised and stops.

For an unmerged branch, name it with `?ref=` — branch names contain slashes,
which `owner/repo/ref` cannot express — and pass `--refresh`, since Nix
otherwise re-resolves a branch ref only hourly and silently runs a stale one:

```sh
nix run --refresh 'github:cprussin/domicile?ref=some/branch#check'
```

## Develop

Nix pins both toolchains; nothing is installed globally.

```sh
nix develop            # core: pure-logic crates + the whole TypeScript workspace
cargo test
bun run turbo test     # lint, types, unit tests, shell builds

nix develop .#full     # adds Wayland/DRM/GL for the compositor and CEF bridge
```

Before a PR: both of the above, plus `cargo fmt --all --check` and
`cargo clippy --all-targets -- -D warnings`. `bun run turbo fix` applies the
auto-fixable half. [AGENTS.md](AGENTS.md) holds the guidelines every change is
held to; [WORKSPACE.md](docs/guidelines/WORKSPACE.md) and
[RUST.md](docs/guidelines/RUST.md) the full workflow.

The Smithay backend is out of the default workspace build:

```sh
nix develop .#full -c cargo build -p domicile-compositor
nix develop .#full -c ./scripts/smoke-compositor.sh   # boots it; a client binds our globals
```

## Layout

One package tree for both languages: a package under `packages/` is a cargo
crate if it has a `Cargo.toml` and a bun workspace if it has a `package.json`.

| Path | What | Build |
|------|------|-------|
| `packages/domicile-config`   | config schema, parsing, hot-reload, chrome-package resolution | core |
| `packages/domicile-scene`    | portal registry, hit-testing, input routing | core |
| `packages/domicile-protocol` | host ↔ in-page bridge messages | core |
| `packages/domicile-host`     | orchestrator brain + host↔chrome IPC seam | core |
| `packages/domicile`          | host daemon: boots from config, serves the chrome protocol | core |
| `packages/domicile-bridge`   | AppTextureBridge bookkeeping (app → engine texture) | core |
| `packages/domicile-compositor` | headless Smithay Wayland server driving the brain | `.#full` |
| `packages/chrome-sdk` | `<domicile-app>` / `<domicile-webview>` elements + bridge client | bun |
| `packages/component-library` | React primitives + the Panda CSS design system chromes extend | bun |
| `packages/test-support` | shared bun test setup (happy-dom, jest-dom, RTL cleanup) | bun |
| `packages/e2e-harness` | headless chrome stand-ins driving `/scripts`, and the check on their machinery | bun |
| `packages/electron-chrome-host` | the Electron host's half of a chrome: its window, the compositor socket, the failure channel | bun |
| `packages/shell-manganese` | the reference chrome: tab rail and stage | bun |
| `packages/shell-simple` | the smallest chrome that works: floating windows, Alt-dragged | bun |
