# @domicile-desktop/ci

## 0.0.3

### Patch Changes

- 65f5ebc: Prebuilt engines and the newest `stable` packages are published in `cprussin/domicile-builds`, and builds older than a week are pruned, so watching `cprussin/domicile` notifies only of real releases.
- a83a6ec: The docs have release notes: Domicile's for shell and app authors at `/docs/release-notes`, and manganese's for its users at `/docs/manganese/release-notes`, back to 1.0.0. The user guide gains an Electron apps page and a Profiles section, and the home and manganese pages point to the new features. A release refuses to run until both pages have a dated entry for its versions.
- 2353b7b: The builds prune deletes releases by id, so drafts that share a tag name no longer stop it.
- 09be8b7: Text fields in pages, web apps and Electron apps check spelling, in American English unless the config's `spellcheck.languages` says otherwise. The dictionaries ship with the engine and are never downloaded. A context menu event over a misspelled word carries `misspelledWord`, `spellingSuggestions` and `replaceMisspelling()`, and runs `add-to-dictionary`; manganese puts the suggestions at the top of the field's menu.
- 501a4b1: The flake serves Domicile from a binary cache at `https://packages.domicile-desktop.com/nix`, filled for each commit `stable` moves to, so `nix run` and configs pinned to `stable` download Domicile instead of building it.

## 0.0.2

### Patch Changes

- 6865a84: The tests of the CI workflows and `.github/scripts` move from `scripts/` into the `ci` package and run in its `test:shell`.
- da62acc: `distro/` and `distro-checks` merge into `packages/distro`. Files every distribution installs (session, launchers, portal, systemd targets, D-Bus service) move from `nix/` to `share/`; `nix/` keeps only the Nix modules.
- ae139f0: `check-runner --jobs N` runs checks at once; a `# check-runner: alone` check runs by itself after the rest. The CI checks run 4 at once.
