#!/usr/bin/env bash
# Fails on a `nix shell`, `nix build` or `nix run` of `nixpkgs#...` without
# `--inputs-from`, on `builtins.getFlake "nixpkgs"`, and on a `.#full` with no
# `NIX_LD`.
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

# The same leak by another spelling: the registry's nixpkgs by name, as
# Chromium's nix-shell was once given. Its build then ran under `.#full`.
FOUND="$(git ls-files -z -- '*.sh' '*.yml' '*.yaml' '*.nix' \
  ":!packages/ci/tests/$(basename "$0")" |
  xargs -0 grep -nF 'getFlake "nixpkgs"')"

if [ -n "$FOUND" ]; then
  printf 'getFlake "nixpkgs" (the host registry, not flake.lock):\n%s\n' \
    "$FOUND" >&2
  exit 1
fi
# The engine the checks build is unpatched, so on NixOS nix-ld picks its glibc:
# the host's unless `.#full` names the locked one.
grep -qE '^ *NIX_LD = pkgs\.stdenv\.cc\.bintools\.dynamicLinker;' flake.nix || {
  echo "flake.nix: .#full sets no NIX_LD, so nix-ld runs the engine on the host's glibc" >&2
  exit 1
}

echo "  ok    every nixpkgs# tool comes from flake.lock"
