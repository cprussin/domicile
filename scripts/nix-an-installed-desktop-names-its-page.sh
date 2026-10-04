#!/usr/bin/env bash
# Checks each desktop wrapper names its own page and that every store path it
# names exists.
#
# A wrapper can reference a store path its derivation does not depend on.
# `nix build` succeeds, and the desktop fails on the machine that installs it.
# A wrapper without `domicile-page-<name>` starts `domicile` with no shell.
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

  # Match the string instead of piping into `grep -q`: under `pipefail`, the
  # writer can get SIGPIPE when grep exits early.
  case "$paths" in
    (*"domicile-page-$name"*) ;;
    (*)
      echo "$name: names no page of its own, so it is not a desktop" >&2
      exit 1
      ;;
  esac
  echo "$name names a page and every path it names is in the store"
done
