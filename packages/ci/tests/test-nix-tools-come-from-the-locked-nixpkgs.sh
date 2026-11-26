#!/usr/bin/env bash
# Fails on a `nix shell`, `nix build` or `nix run` of `nixpkgs#...` without
# `--inputs-from`.
#
# Without it, `nixpkgs` is the host's flake registry entry, not flake.lock's.
# Its tools then run inside a dev shell whose LD_LIBRARY_PATH holds the locked
# nixpkgs' libraries. When the two disagree on glibc, the tool fails to load:
# on #2555 the host's sway (glibc 2.42) loaded the locked glib (GLIBC_2.43).
#
# Reads tracked scripts, workflows and Nix files only, but this one: its own
# comments name the pattern.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

FOUND="$(git ls-files -z -- '*.sh' '*.yml' '*.yaml' '*.nix' \
  ":!packages/ci/tests/$(basename "$0")" |
  xargs -0 grep -nE '\bnix +(shell|build|run)\b.*nixpkgs#' |
  grep -v -- '--inputs-from')"

if [ -n "$FOUND" ]; then
  printf 'nixpkgs# without --inputs-from (resolves to the host registry):\n%s\n' \
    "$FOUND" >&2
  exit 1
fi
echo "  ok    every nixpkgs# tool comes from flake.lock"
