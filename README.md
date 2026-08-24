# Domicile

A Wayland compositor whose renderer is a web engine. All user chrome is web
content; app windows are real Wayland clients composited *inside* the engine as
DOM elements, so `<app>` takes the same CSS as a `<div>`.

A GPU client's buffer is composited directly, with no copy; a `wl_shm` client's
frames are still read back and sent to the engine
([why](docs/architecture/WINDOW-COMPOSITING.md)).
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) ·
[ROADMAP.md](ROADMAP.md)

## Run

Needs Nix and a display. Nothing to clone.

```sh
nix run github:cprussin/domicile              # manganese: tabs, stage, address bar
nix run github:cprussin/domicile -- simple    # simple: floating windows only
```

From a checkout:

```sh
nix develop .#full -c ./scripts/run-native.sh          # manganese
nix develop .#full -c ./scripts/run-native.sh simple
```

## Open an app

**Alt+Enter** opens a terminal in either shell. Anything started from it lands
on the desktop too.

From outside, point any Wayland client at Domicile's display. Domicile prints
both values on startup — `apps on WAYLAND_DISPLAY=…, under XDG_RUNTIME_DIR=…` —
because it takes the runtime dir from your session and lets the socket name
itself, so neither is a constant to write down here:

```sh
nix shell nixpkgs#weston -c \
  env XDG_RUNTIME_DIR=<as printed> WAYLAND_DISPLAY=<as printed> weston-flower
```

No XWayland — an X11-only client silently opens on your own desktop instead.

## simple's controls

| | |
|---|---|
| Alt + press | raise |
| Alt + drag | move (and raise) |
| Alt + right-drag | resize (and raise) |

A window leaves when its client exits. There is no close button.

## Check

```sh
nix run github:cprussin/domicile#check    # rust + typescript + every e2e script
```

Individual apps are the `apps` set in `flake.nix`; scripts without one run as
`nix develop .#full -c ./scripts/<name>.sh`. For a branch:

```sh
nix run --refresh 'github:cprussin/domicile?ref=some/branch#check'
```

## Develop

```sh
nix develop         # core crates + TypeScript workspace
cargo test
bun run turbo test

nix develop .#full  # adds Wayland/DRM/GL for the compositor
```

Before a PR also run `cargo fmt --all --check` and
`cargo clippy --all-targets -- -D warnings`; `bun run turbo fix` handles the
auto-fixable half. [AGENTS.md](AGENTS.md) has the guidelines every change is
held to.

Packages live in `packages/` — cargo crate if it has a `Cargo.toml`, bun
workspace if it has a `package.json`. The bun packages have their own READMEs;
the crates' roles are in
[ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md#crate-layout).
