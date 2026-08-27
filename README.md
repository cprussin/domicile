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

To install one rather than run it out of the source, build the shell you want.
There is no default and nothing called `domicile`: what you install is a
desktop, and it starts the compositor itself.

```sh
nix profile install github:cprussin/domicile#manganese
nix build github:cprussin/domicile#simple    # ./result/bin/simple
```

Configuration is the shell's own, at `$XDG_CONFIG_HOME/domicile/<shell>.json`
— see its README.

An installed shell runs sandboxed and needs no flags on an ordinary host. Where
the machine cannot manage that — unprivileged user namespaces disabled, or a
container running as root — Electron says so and stops, and the machine passes
what it needs in `DOMICILE_ELECTRON_ARGS` (`--no-sandbox`, and `--disable-gpu`
where there is no GPU). That is the machine's business rather than the shell's,
so neither package bakes any in.

Each shell's README has its keys: [simple](packages/shell-simple/README.md),
[manganese](packages/shell-manganese/README.md). Joining the desktop from
outside — a Wayland client pointed at Domicile's display — is
[in simple's](packages/shell-simple/README.md#launch-an-app-into-it), and is
the same mechanism under either shell.

## Write your own shell

The shell is all the user chrome — panels, decorations, launcher — *and* the
program that starts the compositor. `manganese` and `simple` ship here, but
neither is privileged: a shell is an ordinary program in its own repository,
built against `@domicile/chrome-sdk`, installed on your `PATH`, and run by
name.

```sh
my-shell
```

Which is the whole interface. A shell owns its own configuration and starts
`domicile-compositor` itself, so someone using your desktop never runs anything
of Domicile's and never configures it directly.

[docs/WRITING-A-SHELL.md](docs/WRITING-A-SHELL.md) is the guide;
[examples/minimal-shell](examples/minimal-shell) is a complete one in about two
hundred and fifty lines, built against the published SDK from outside this
workspace exactly as yours would be. The two shells in `packages/` are built on
that floor rather than instead of it:
[`shell-simple`](packages/shell-simple/README.md) is windows, gestures and a
terminal shortcut, [`shell-manganese`](packages/shell-manganese/README.md) the
bundled reference chrome.

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
