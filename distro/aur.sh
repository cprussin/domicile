#!/usr/bin/env bash
# Writes the AUR package `domicile-bin`, which installs the Arch package from
# the pacman repository.
#
#   distro/aur.sh <package> <repository url> <out>
#
# - <package>: the Arch package `distro/build.sh` made, as published.
# - <repository url>: where `distro/repo.sh`'s repositories are served.
# - <out>: created; gets `PKGBUILD`, `.SRCINFO` and `domicile.install`, the
#   files the AUR's git repository holds.
#
# The PKGBUILD copies the package's dependencies, backups and install script
# from its `.PKGINFO` and `.INSTALL`. `.SRCINFO` is what `makepkg
# --printsrcinfo` prints for it. Needs `bsdtar` on PATH.
set -euo pipefail

[ "$#" -eq 3 ] || {
  echo "usage: aur.sh <package> <repository url> <out>" >&2
  exit 2
}
PACKAGE="$1"
URL="${2%/}"
OUT="$3"
mkdir -p "$OUT"

FILE="$(basename "$PACKAGE")"
PKGINFO="$(bsdtar -xOf "$PACKAGE" .PKGINFO)"

# The values of <key> in `.PKGINFO`, one per line.
lines() { # key
  sed -n "s/^$1 = //p" <<<"$PKGINFO"
}

# The values of <key> in `.PKGINFO`, each quoted for bash.
values() { # key
  lines "$1" | while IFS= read -r value; do
    printf ' %q' "$value"
  done
}

# `.SRCINFO` lines naming each value of <key> in `.PKGINFO` as <field>.
srcinfo() { # field, key
  lines "$2" | sed "s/^/\t$1 = /"
}

full="$(lines pkgver)"
pkgver="${full%-*}"
pkgrel="${full##*-}"

SHA256="$(sha256sum "$PACKAGE" | cut -d' ' -f1)"

bsdtar -xOf "$PACKAGE" .INSTALL >"$OUT/domicile.install"

cat >"$OUT/PKGBUILD" <<PKGBUILD
# Maintainer: Connor Prussin <connor@prussin.net>
# Written by distro/aur.sh in https://github.com/cprussin/domicile.
pkgname=domicile-bin
pkgver=$pkgver
pkgrel=$pkgrel
pkgdesc=$(printf %q "$(lines pkgdesc)")
arch=(x86_64)
url=https://github.com/cprussin/domicile
license=($(values license) )
depends=($(values depend) )
optdepends=($(values optdepend) )
provides=(domicile)
conflicts=(domicile)
backup=($(values backup) )
install=domicile.install
source=("$FILE::$URL/arch/x86_64/$FILE")
noextract=("$FILE")
sha256sums=($SHA256)

package() {
  bsdtar -xpf "\$srcdir/$FILE" -C "\$pkgdir" \\
    --exclude .PKGINFO --exclude .MTREE --exclude .BUILDINFO --exclude .INSTALL
}
PKGBUILD

{
  echo "pkgbase = domicile-bin"
  printf '\tpkgdesc = %s\n' "$(lines pkgdesc)"
  printf '\tpkgver = %s\n\tpkgrel = %s\n' "$pkgver" "$pkgrel"
  printf '\turl = https://github.com/cprussin/domicile\n'
  printf '\tinstall = domicile.install\n'
  printf '\tarch = x86_64\n'
  srcinfo license license
  srcinfo depends depend
  srcinfo optdepends optdepend
  printf '\tprovides = domicile\n\tconflicts = domicile\n'
  printf '\tnoextract = %s\n' "$FILE"
  srcinfo backup backup
  printf '\tsource = %s::%s\n' "$FILE" "$URL/arch/x86_64/$FILE"
  printf '\tsha256sums = %s\n' "$SHA256"
  printf '\npkgname = domicile-bin\n'
} >"$OUT/.SRCINFO"
