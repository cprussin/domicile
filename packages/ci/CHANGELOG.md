# @domicile-desktop/ci

## 0.0.3

### Patch Changes

- 27376e2: After main's engine release builds at a new Chromium pin, it copies its built tree over the other tree on the build machine, so the next run there starts warm instead of rebuilding Chromium for hours. The copy shares disk blocks and skips any tree in use.
- 65f5ebc: Prebuilt engines and the newest `stable` packages are published in `cprussin/domicile-builds`, and builds older than a week are pruned, so watching `cprussin/domicile` notifies only of real releases.
- a83a6ec: The docs have release notes: Domicile's for shell and app authors at `/docs/release-notes`, and manganese's for its users at `/docs/manganese/release-notes`, back to 1.0.0. The user guide gains an Electron apps page and a Profiles section, and the home and manganese pages point to the new features. A release refuses to run until both pages have a dated entry for its versions.
- 2353b7b: The builds prune deletes releases by id, so drafts that share a tag name no longer stop it.
- 8a16098: The Site workflow only moves `site` forward, which its ruleset requires: new picks go on top, and a release is merged in.
- 8c467d9: A Chromium tree copied after a pin roll now starts warm: the copy carries the build tool's saved state over to its own path, so its first build takes minutes instead of re-running every step.
- 5fe0d76: A pull request's engine run is no longer canceled as stale when the branch moves only outside the engine's paths, such as the docs media bot's retake commit. That run builds the same engine, and canceling it restarted a cold compile hours in.
- 09be8b7: Text fields in pages, web apps and Electron apps check spelling, in American English unless the config's `spellcheck.languages` says otherwise. The dictionaries ship with the engine and are never downloaded. A context menu event over a misspelled word carries `misspelledWord`, `spellingSuggestions` and `replaceMisspelling()`, and runs `add-to-dictionary`; manganese puts the suggestions at the top of the field's menu.
- 501a4b1: The flake serves Domicile from a binary cache at `https://packages.domicile-desktop.com/nix`, filled for each commit `stable` moves to, so `nix run` and configs pinned to `stable` download Domicile instead of building it.
- 9795aef: An engine build that finds the Chromium tree at its pin held now waits for it rather than taking a tree at another pin and rebuilding Chromium from scratch. It still takes the other tree once its wait runs out, or when another run is already waiting.

## 0.0.2

### Patch Changes

- 6865a84: The tests of the CI workflows and `.github/scripts` move from `scripts/` into the `ci` package and run in its `test:shell`.
- da62acc: `distro/` and `distro-checks` merge into `packages/distro`. Files every distribution installs (session, launchers, portal, systemd targets, D-Bus service) move from `nix/` to `share/`; `nix/` keeps only the Nix modules.
- ae139f0: `check-runner --jobs N` runs checks at once; a `# check-runner: alone` check runs by itself after the rest. The CI checks run 4 at once.
