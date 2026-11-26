#!/usr/bin/env bash
# Put the crates ad blocking needs into the Chromium checkout, where
# `cargo vendor` would: third_party/rust/chromium_crates_io/vendor.
#
#   .github/scripts/engine-crates.sh <path to chromium/src>
#
# Runs after `apply.sh`. Each line of packages/domicile-engine/crates/CRATES
# names a crate, its version, its directory under vendor/ and the sha256 of
# its `.crate`, fetched from crates.io (`DOMICILE_CRATES_URL` names another
# mirror). A crate's directory is its `.crate`'s files, as `cargo vendor`
# leaves them; the series' BUILD.gn for it is under src/third_party/rust.
#
# The Chromium tree must not see them: `apply.sh` refuses a dirty tree, and
# the series stamp counts CRATES instead. So each directory goes in
# `.git/info/exclude`. A stamp in each names its sum, so a warm run fetches
# nothing and keeps the mtimes ninja reads. A directory with a stamp that
# CRATES no longer names is removed.
set -euo pipefail

CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || {
  echo "usage: engine-crates.sh <path to chromium/src>" >&2
  exit 2
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MANIFEST="$ROOT/packages/domicile-engine/crates/CRATES"
URL="${DOMICILE_CRATES_URL:-https://static.crates.io/crates}"
VENDOR="$CHROMIUM/third_party/rust/chromium_crates_io/vendor"
STAMP=.domicile-crate

[ -f "$MANIFEST" ] || {
  echo "::error::$MANIFEST, the crates the engine builds with, is missing" >&2
  exit 1
}
[ -d "$VENDOR" ] || {
  echo "::error::$VENDOR is missing: is $CHROMIUM a Chromium checkout?" >&2
  exit 1
}
exclude="$(git -C "$CHROMIUM" rev-parse --absolute-git-dir)/info/exclude"
mkdir -p "$(dirname "$exclude")"
touch "$exclude"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

wanted=" "
while read -r name version dir sum; do
  case "$name" in "" | "#"*) continue ;; esac
  wanted="$wanted$dir "
  target="$VENDOR/$dir"
  if [ -f "$target/$STAMP" ] && [ "$(cat "$target/$STAMP")" = "$sum" ]; then
    continue
  fi
  file="$work/$name-$version.crate"
  curl -sSfL --retry 3 -o "$file" "$URL/$name/$name-$version.crate" || {
    echo "::error::could not fetch $name-$version.crate from $URL" >&2
    exit 1
  }
  got="$(sha256sum <"$file" | cut -d' ' -f1)"
  [ "$got" = "$sum" ] || {
    echo "::error::$name-$version.crate has sha256 $got, and crates/CRATES says $sum" >&2
    exit 1
  }
  rm -rf "$target" "$work/unpacked"
  mkdir -p "$work/unpacked"
  tar -xzf "$file" -C "$work/unpacked"
  mv "$work/unpacked/$name-$version" "$target"
  printf '%s' "$sum" >"$target/$STAMP"
  echo "$dir: $name $version"
done <"$MANIFEST"

for stamp in "$VENDOR"/*/"$STAMP"; do
  [ -f "$stamp" ] || continue
  dir="$(basename "$(dirname "$stamp")")"
  case "$wanted" in *" $dir "*) continue ;; esac
  rm -rf "${VENDOR:?}/$dir"
  echo "$dir: removed, as crates/CRATES no longer names it"
done

# Exactly CRATES' directories, so a dropped crate's line goes too.
prefix=/third_party/rust/chromium_crates_io/vendor/
{
  grep -v "^$prefix" "$exclude" || true
  for dir in $wanted; do echo "$prefix$dir/"; done
} >"$work/exclude"
cp "$work/exclude" "$exclude"
