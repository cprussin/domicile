# @domicile-desktop/ci

## 0.0.3

### Patch Changes

- 501a4b1: The flake serves Domicile from a binary cache at `https://packages.domicile-desktop.com/nix`, filled for each commit `stable` moves to, so `nix run` and configs pinned to `stable` download Domicile instead of building it.
- a83a6ec: The docs have release notes: Domicile's for shell and app authors at `/docs/release-notes`, and manganese's for its users at `/docs/manganese/release-notes`, back to 1.0.0. The user guide gains an Electron apps page and a Profiles section, and the home and manganese pages point to the new features. A release refuses to run until both pages have a dated entry for its versions.

## 0.0.2

### Patch Changes

- 6865a84: The tests of the CI workflows and `.github/scripts` move from `scripts/` into the `ci` package and run in its `test:shell`.
- da62acc: `distro/` and `distro-checks` merge into `packages/distro`. Files every distribution installs (session, launchers, portal, systemd targets, D-Bus service) move from `nix/` to `share/`; `nix/` keeps only the Nix modules.
- ae139f0: `check-runner --jobs N` runs checks at once; a `# check-runner: alone` check runs by itself after the rest. The CI checks run 4 at once.
