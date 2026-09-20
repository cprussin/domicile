#!/usr/bin/env bash
# That an installed desktop's launcher names a page, and that every store path
# it names is in the store.
#
# A desktop the flake ships is a wrapper script: it names `domicile`, a page,
# and whatever else it needs, all by absolute store path. So the wrapper is the
# one place a missing runtime dependency shows up — a nix expression that
# referred to a derivation it did not depend on produces a script naming a path
# that is not there, and `nix build` is perfectly happy with it. The desktop
# then fails on the machine that installs it.
#
# AND IT MUST NAME A PAGE OF ITS OWN, which is the check that says it is a
# desktop at all rather than a wrapper that starts `domicile` with nothing to
# show. `simple` and `manganese` are built from different pages and neither is
# privileged; a wrapper naming no `domicile-page-<name>` has lost its shell.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

for name in manganese simple; do
  out="$(nix build --no-link --print-out-paths ".#$name")"
  [ -x "$out/bin/$name" ] || {
    echo "$name: no bin/$name in $out" >&2
    exit 1
  }

  paths="$(grep -oE '/nix/store/[a-z0-9]{32}-[^"'"'"'}: ]*' "$out/bin/$name" |
    sort -u)"
  [ -n "$paths" ] || {
    echo "$name: names no store paths at all, so it cannot be a desktop — it" >&2
    echo "  has nothing to start" >&2
    exit 1
  }
  for path in $paths; do
    [ -e "$path" ] || {
      echo "$name: names $path, which is not in the store" >&2
      exit 1
    }
  done

  # Matched against the string rather than piped, for the reason the sibling
  # check's header gives: `grep -q` closes the pipe the moment it matches, and
  # under `pipefail` whatever was writing into it can lose the race and fail
  # the pipeline. Nothing here is expensive enough to need a pipe.
  case "$paths" in
    (*"domicile-page-$name"*) ;;
    (*)
      echo "$name: names no page of its own, so it is not a desktop" >&2
      exit 1
      ;;
  esac
  echo "$name names a page and every path it names is in the store"
done
