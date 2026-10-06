# Picks which published engine `nix build .#engine` fetches.
#
# Each engine series is published as two builds:
# - `engine-release.nix`: the checked build a pull request builds and pins.
#   DCHECKs on, no PGO.
# - `engine-official.nix`: the faster optimized build that engine-release.yml
#   makes nightly from main. It can lag a merge by up to a day.
#
# Use the official build only when it matches the checked pin's series, so the
# engine never lacks a patch in this tree.
# `scripts/test-the-pinned-engine-is-this-series.sh` checks that the checked pin
# matches the tree.
#
# The `stable` branch tracks the newest main where this picks the official
# build; see .github/scripts/promote-stable.sh.
{ checked, official ? null }:
if official != null && official.identity == checked.identity then official else checked
