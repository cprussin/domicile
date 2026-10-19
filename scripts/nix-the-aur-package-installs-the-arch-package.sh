#!/usr/bin/env bash
# Checks `distro/aur.sh`: makepkg builds the `domicile-bin` PKGBUILD it writes
# into a package with the Arch package's files, dependencies, backups and
# install script.
#
# Uses a small stand-in for the Arch package `distro/build.sh` makes. makepkg
# refuses to run as root, so as root this builds as `nobody`.
#
# `DOMICILE_AUR_TOOLS=1` says the tools below are on PATH already; otherwise
# they come from the flake's nixpkgs. They include a userland, because fakeroot
# preloads a library built against nixpkgs' glibc into every program makepkg
# runs.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix

if [ "${DOMICILE_AUR_TOOLS:-}" != 1 ]; then
  tools=(pacman fakeroot nfpm libarchive zstd bash coreutils findutils gnugrep gnused
    gawk gnutar gzip diffutils file)
  exec nix shell --inputs-from "$ROOT" "${tools[@]/#/nixpkgs#}" --command env DOMICILE_AUR_TOOLS=1 "$0"
fi

WORK="$(mktemp -d)"
chmod 755 "$WORK"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "wanted: $(printf '%q' "$2")  got: $(printf '%q' "$3")"
  fi
}

# The stand-in: a file, a config file, dependencies, optional dependencies and
# an install script.
mkdir -p "$WORK/content"
echo shell >"$WORK/content/shell"
echo pam >"$WORK/content/pam"
printf '#!/bin/sh\necho installed\n' >"$WORK/content/postinstall.sh"
cat >"$WORK/nfpm.yaml" <<YAML
name: domicile
arch: amd64
version: "1.2.3"
release: "1"
maintainer: Test <test@domicile.invalid>
description: A stand-in.
license: MIT AND BSD-3-Clause
contents:
  - src: $WORK/content/shell
    dst: /usr/libexec/domicile/shell
  - src: $WORK/content/pam
    dst: /etc/pam.d/domicile
    type: config|noreplace
scripts:
  postinstall: $WORK/content/postinstall.sh
overrides:
  archlinux:
    depends:
      - glibc>=2.36
      - mesa
YAML
PACKAGE="$WORK/domicile-1.2.3-1-x86_64.pkg.tar.zst"
nfpm package --config "$WORK/nfpm.yaml" --packager archlinux --target "$PACKAGE" >/dev/null
printf 'upower: the battery readout\n' >"$WORK/optdepends"
"$ROOT/distro/arch-optdepends.sh" "$PACKAGE" "$WORK/optdepends"

AUR="$WORK/aur"
echo "the AUR package"
if out="$("$ROOT/distro/aur.sh" "$PACKAGE" "https://packages.invalid" "$AUR" 2>&1)"; then
  ok "aur.sh writes it"
else
  fail "aur.sh writes it" "$out"
fi
expect "it holds the PKGBUILD, .SRCINFO and install script" \
  ".SRCINFO PKGBUILD domicile.install" "$(ls -A "$AUR" 2>&1 | paste -sd' ')"
grep -q 'https://packages.invalid/arch/x86_64/domicile-1.2.3-1-x86_64.pkg.tar.zst' "$AUR/PKGBUILD" &&
  ok "it downloads the package from the repository" ||
  fail "it downloads the package from the repository" "$(grep source "$AUR/PKGBUILD")"

echo "makepkg builds it"
BUILD="$WORK/build"
cp -r "$AUR" "$BUILD"
# Stands in for the download.
cp "$PACKAGE" "$BUILD/"
chmod -R a+rwX "$BUILD"
# The nixpkgs makepkg's own configuration: no system one is on PATH.
CONFIG="$(dirname "$(command -v makepkg)")/../etc/makepkg.conf"
as_builder=()
[ "$(id -u)" != 0 ] || as_builder=(setpriv --reuid=nobody --regid=nogroup --clear-groups --reset-env)
if out="$(cd "$BUILD" && "${as_builder[@]}" env PATH="$PATH" HOME="$BUILD" PKGDEST="$BUILD" \
  makepkg --config "$CONFIG" --nodeps --noconfirm 2>&1)"; then
  ok "makepkg succeeds"
else
  fail "makepkg succeeds" "$out"
fi
if out="$(cd "$BUILD" && "${as_builder[@]}" env PATH="$PATH" HOME="$BUILD" makepkg --config "$CONFIG" --printsrcinfo 2>&1)"; then
  expect ".SRCINFO is makepkg's" "$out" "$(cat "$AUR/.SRCINFO")"
else
  fail ".SRCINFO is makepkg's" "$out"
fi

BUILT="$(echo "$BUILD"/domicile-bin-1.2.3-1-x86_64.pkg.tar.*)"
files() { bsdtar -tf "$1" | grep -v '^\.' | sort; }
info() { # package, key
  bsdtar -xOf "$1" .PKGINFO | sed -n "s/^$2 = //p"
}
expect "the same files" "$(files "$PACKAGE")" "$(files "$BUILT" 2>&1)"
for key in depend optdepend backup license; do
  expect "the same $key" "$(info "$PACKAGE" "$key")" "$(info "$BUILT" "$key" 2>&1)"
done
expect "the same install script" "$(bsdtar -xOf "$PACKAGE" .INSTALL)" \
  "$(bsdtar -xOf "$BUILT" .INSTALL 2>&1)"
expect "it provides domicile" domicile "$(info "$BUILT" provides 2>&1)"
expect "and conflicts with it" domicile "$(info "$BUILT" conflict 2>&1)"

[ "$FAILED" -eq 0 ]
