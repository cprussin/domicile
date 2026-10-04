# Building on crux

`crux` is the only machine that builds the engine. CI and people share its
Chromium trees.

The engine job (`.github/workflows/engine.yml`) runs on any change to
`packages/domicile-engine` except Markdown, `engine-release.nix` and
`engine-official.nix`. `/scripts/test-engine-path-filter.sh` checks this.

## Sharing the checkout with CI

- CI resets the tree. `engine.yml` and `engine-release.yml` reset it to the
  pin and apply the series. Uncommitted work in the checkout is lost, so keep
  your work in this repo.
- Take the lock around your builds:

  ```sh
  .github/scripts/engine-tree-lock.sh take /build/chromium/src "<who>"
  ```

  Drop it with the same owner string:

  ```sh
  .github/scripts/engine-tree-lock.sh drop /build/chromium/src "<who>"
  ```

  `who` shows the holder. The `take` error message explains how to clear a
  stale lock. The lock is
  `/build/.domicile-tree-lock-<tree>`, named after the resolved path, so
  `/build/chromium/src` and `/build/trees/tree-0/src` share a lock.
- `/build/chromium` is a symlink for people. CI picks its own tree. Point the
  symlink with `.github/scripts/engine-tree-pool.sh use <pin>`, and still take the lock.
- Mirror every new file in `src/`. The reset removes the series' files by
  walking `src/`. Any other file survives, `apply.sh` then refuses the dirty
  tree, and someone else's pull request fails.

## Toolchain shell

`build.sh`, `spike.sh` and the guards must run inside Chromium's Nix shell. A
component build links against that shell's glibc.

```sh
NIX_SHELL_RUN="$PWD/scripts/guard-css-and-resize.sh /build/chromium/src" \
  nix-shell /build/chromium/src/tools/nix/shell.nix
```

`apply.sh` ends in `git am`, which needs a committer identity. A fresh checkout
has none:

```sh
git -C /build/chromium/src config user.name  "..."
git -C /build/chromium/src config user.email "..."
```

## Moving the pin

1. Edit `CHROMIUM_PIN`.
2. Open a PR. The engine job reports which patches reject.
3. Fix each reject in the checkout, then run `extract.sh`.
4. Copy any new file into `src/`.

Past roll conflicts and what to check:
[BUILDING-CHROMIUM.md](BUILDING-CHROMIUM.md#rolling-the-pin).

### What CI does

Every engine workflow runs two scripts, under the tree lock:

| Script | Role |
|---|---|
| `.github/scripts/engine-reset.sh` | fetches the revision if the checkout lacks it, then resets onto it |
| `.github/scripts/engine-sync.sh` | runs `gclient sync` so everything in `DEPS` matches the pin |

- The last synced pin is stored next to the checkout, in
  `/build/chromium/.domicile-synced-pin`. A run whose pin matches it skips
  `gclient`.
- `engine-reset.sh` deletes the stamp when it finds `DEPS` out of step with the
  pin.

## Tree pool

Changing the pin, forward or back, rebuilds all of `out/` (about four hours).
Several trees let a repin branch build without forcing other branches to
rebuild.

- `/build/trees` holds the trees.
  `.github/scripts/engine-tree-pool.sh pick <pin> <who>` picks and locks one in
  a single call.
- Pick order:
  1. a tree whose stamp (`engine-series-stamp.sh`) says it carries the pin.
     After the pick, the stamp check decides whether to skip reset, sync,
     apply and compile;
  2. otherwise an unused tree, then the least recently used one.
- A tree another run holds is skipped. `crux` has two heavy runners, so two
  engine jobs can run at once.
- If every tree is held, one run waits up to 45 minutes
  (`DOMICILE_TREE_WAIT`). Any other run is refused.
- **Memory:** 62 GB, no swap. A cold link uses most of it, so
  `.github/scripts/engine-compile-slot.sh` allows one cold build at a time.
  Runs on a tree that already carries the series skip the slot.
- **Setup:** `setup-chromium-trees.service` creates the trees
  (`cprussin/dotfiles`: `config/machines/crux/chromium-build.nix`). The pool
  creates nothing. Without that unit, a run uses the single tree.

## Build cost

From scratch on `crux` (16 cores, no remote execution, no cache):

| | |
|---|---|
| wall clock | 4h 16m, 56,376 steps |
| CPU | ~13.5× parallel |
| disk | 97 GB for `depot_tools`, the checkout and `out/Domicile` |

On a tree already built at the pin:

| | |
|---|---|
| null build | 6–7s |
| apply the whole series, `autoninja chrome` | 65s |
| edit one series file, rebuild `chrome` | 13–14s |
