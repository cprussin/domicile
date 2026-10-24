#!/usr/bin/env bash
# Checks `release-aur.sh`: a release commits `distro/aur.sh`'s package to the
# AUR's git repository, a rerun commits nothing, and a dry run pushes nothing.
#
# A local repository stands in for the AUR's, and a small package for the Arch
# package `distro/build.sh` makes.
#
# `DOMICILE_AUR_TOOLS=1` says nfpm and libarchive are on PATH already;
# otherwise they come from the flake's nixpkgs.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
. "$ROOT/packages/distro-checks/lib/nix-check.sh"
require_nix

if [ "${DOMICILE_AUR_TOOLS:-}" != 1 ]; then
  exec nix shell --inputs-from "$ROOT" nixpkgs#nfpm nixpkgs#libarchive \
    --command env DOMICILE_AUR_TOOLS=1 "$0"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# The stand-in Arch package at <version>.
package() { # version
  mkdir -p "$WORK/content"
  echo "$1" >"$WORK/content/version"
  printf '#!/bin/sh\n' >"$WORK/content/postinstall.sh"
  cat >"$WORK/nfpm.yaml" <<YAML
name: domicile
arch: amd64
version: "$1"
release: "1"
maintainer: Test <test@domicile.invalid>
description: A stand-in.
license: MIT
contents:
  - src: $WORK/content/version
    dst: /usr/share/domicile/version
scripts:
  postinstall: $WORK/content/postinstall.sh
YAML
  nfpm package --config "$WORK/nfpm.yaml" --packager archlinux \
    --target "$WORK/domicile-$1-1-x86_64.pkg.tar.zst" >/dev/null
  echo "$WORK/domicile-$1-1-x86_64.pkg.tar.zst"
}

AUR="$WORK/aur.git"
git init -q --bare "$AUR"
release() { # package, environment...
  local package="$1"
  shift
  # No git identity, as on a CI runner.
  (cd "$ROOT" && env DOMICILE_AUR_REMOTE="$AUR" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    EMAIL= "$@" \
    .github/scripts/release-aur.sh "$package" https://packages.invalid 2>&1)
}
commits() { git -C "$AUR" log --format=%s master 2>/dev/null; }

echo "== the first release =="
if out="$(release "$(package 1.2.3)")"; then
  expect "commits domicile-bin 1.2.3-1" "domicile-bin 1.2.3-1" "$(commits)"
  expect "as the package's maintainer" "Connor Prussin <connor@prussin.net>" \
    "$(git -C "$AUR" log -1 --format='%an <%ae>' master 2>&1)"
  expect "with the AUR's files" ".SRCINFO PKGBUILD domicile.install" \
    "$(git -C "$AUR" ls-tree --name-only master | paste -sd' ')"
else
  printf '  FAIL  the release succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

echo "== a rerun =="
if out="$(release "$WORK/domicile-1.2.3-1-x86_64.pkg.tar.zst")"; then
  expect "commits nothing" "domicile-bin 1.2.3-1" "$(commits)"
else
  printf '  FAIL  the rerun succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

echo "== a dry run =="
if out="$(release "$(package 1.2.4)" DOMICILE_RELEASE_DRY_RUN=1)"; then
  expect "pushes nothing" "domicile-bin 1.2.3-1" "$(commits)"
else
  printf '  FAIL  the dry run succeeds\n    %s\n' "$out"
  FAILED=$((FAILED + 1))
fi

[ "$FAILED" -eq 0 ]
