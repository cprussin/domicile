# Developing Domicile

How to run, test and debug Domicile from a checkout. Code rules are in
[/docs/guidelines/](/docs/guidelines/). Compositor debugging is in
[COMPOSITOR-DEBUGGING.md](COMPOSITOR-DEBUGGING.md).

## Run and test

```sh
nix develop                  # core shell: rust + node
cargo test                   # Rust unit tests
bun run turbo test           # TypeScript: lint, types, unit tests

nix develop .#full           # adds wayland, mesa, weston, kitty
./scripts/check.sh           # all checks; run before every push
./scripts/check.sh e2e       # one group: shell, rust, typescript, e2e, engine, nix
```

- `check.sh` runs every `scripts/test-*.sh` and `scripts/e2e-*.sh` by glob. A
  new script in that pattern runs automatically.
- `scripts/smoke-compositor.sh` is not in `check.sh`. Run it by hand.
- No test needs a display.
- The flake has no app for running checks; use a checkout.
- For what a green run does not cover, see `AGENTS.md`,
  *Checking your work*.

## Run a desktop

On a machine with a screen:

```sh
nix run 'github:cprussin/domicile#manganese'            # the reference shell
nix run 'github:cprussin/domicile' -- ./dist/shell.js   # your own shell
./scripts/dev-shell.sh manganese                        # rebuild and reload on edit
```

`dev-shell.sh` sends each finished build to its running desktop with
`domicile load-shell`. Windows stay open across reloads. If the engine rejects
a build (for example, a syntax error), it prints the error and keeps the
previous shell.

## The engine build machine

- The engine job on `crux` is the only thing that builds the Chromium fork and
  runs the pixel guards.
- It shares a checkout with other users, so it takes a lock first:
  `.github/scripts/engine-tree-lock.sh`.
- Run the same lock script before building by hand on `crux`.

## Gotchas

- **`nix develop` only sees git-tracked files.** A new untracked file fails with
  "not tracked by Git". Run `git add` on it. A dirty tree only warns.
- **`nix run github:…?ref=<branch>` caches a branch for an hour.** A run right
  after a push uses the old revision. Pass `--refresh` when the branch is
  changing.
- **Unix socket paths are limited to about 108 characters.** Use a short
  `XDG_RUNTIME_DIR`, such as `/tmp/domicile-rt`.
- **gpg signing fails in the agent container.** Commit with
  `git -c commit.gpgsign=false …`.
- **`cargo test` may fail to link outside `nix develop .#full`.**
  `domicile-compositor` links libxkbcommon. The error is
  `unable to find library -lxkbcommon`. Without the library, `check.sh` skips
  `cargo test` and says why. Use `nix develop .#full`, or install
  `libxkbcommon-dev` (as `cargo-test.yml` does).
