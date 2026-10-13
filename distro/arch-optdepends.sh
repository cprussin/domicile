#!/usr/bin/env bash
# Adds optional dependencies to an Arch package nfpm made. nfpm writes no
# `optdepend`.
#
#   distro/arch-optdepends.sh <package> <list>
#
# <list> holds a `name: reason` per line; `#` lines and blank lines are
# skipped. Rewrites `.PKGINFO` and its line in `.MTREE`, keeping their times,
# and copies every other entry as it is.
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: arch-optdepends.sh <package> <list>" >&2
  exit 2
}
PACKAGE="$1"
LIST="$2"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TREE="$WORK/tree"
mkdir -p "$TREE"

# Packed again in the order listed here. GNU tar's `--delete` corrupts nfpm's
# archives.
tar --zstd -tf "$PACKAGE" >"$WORK/order"
tar -C "$TREE" --warning=no-timestamp --zstd -xf "$PACKAGE"
touch -r "$TREE/.PKGINFO" "$WORK/pkginfo-time"
touch -r "$TREE/.MTREE" "$WORK/mtree-time"

grep -v -e '^#' -e '^$' "$LIST" | sed 's/^/optdepend = /' >>"$TREE/.PKGINFO"
touch -r "$WORK/pkginfo-time" "$TREE/.PKGINFO"

gzip -dc "$TREE/.MTREE" | awk \
  -v size="$(stat -c %s "$TREE/.PKGINFO")" \
  -v md5="$(md5sum <"$TREE/.PKGINFO" | cut -d' ' -f1)" \
  -v sha256="$(sha256sum <"$TREE/.PKGINFO" | cut -d' ' -f1)" '
  $1 == "./.PKGINFO" {
    for (i = 2; i <= NF; i++) {
      if ($i ~ /^size=/) { $i = "size=" size }
      if ($i ~ /^md5digest=/) { $i = "md5digest=" md5 }
      if ($i ~ /^sha256digest=/) { $i = "sha256digest=" sha256 }
    }
  }
  { print }' | gzip -n >"$WORK/mtree"
mv "$WORK/mtree" "$TREE/.MTREE"
touch -r "$WORK/mtree-time" "$TREE/.MTREE"

tar -C "$TREE" --owner=root:0 --group=root:0 --no-recursion \
  -T "$WORK/order" --zstd -cf "$WORK/package.pkg.tar.zst"
mv "$WORK/package.pkg.tar.zst" "$PACKAGE"
