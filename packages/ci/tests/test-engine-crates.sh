#!/usr/bin/env bash
# Asserts `engine-crates.sh` puts each crate CRATES names into the checkout's
# third_party/rust/chromium_crates_io/vendor, as `cargo vendor` would.
#
# - **Checked by sum.** A `.crate` whose sha256 is not CRATES' fails the run
#   and lays nothing down.
# - **The Chromium tree stays clean.** `apply.sh` refuses a dirty tree, so each
#   directory goes in `.git/info/exclude`.
# - **Warm runs fetch nothing**, so ninja's mtimes stay.
# - **A crate CRATES drops is removed**, with its exclude line.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CRATES_SH="$ROOT/.github/scripts/engine-crates.sh"
[ -x "$CRATES_SH" ] || { echo "no $CRATES_SH" >&2; exit 1; }
command -v git >/dev/null || { echo "  SKIP: no git"; exit 77; }
command -v curl >/dev/null || { echo "  SKIP: no curl"; exit 77; }

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
gitq() { git -c user.email=t@example.invalid -c user.name=t "$@"; }

# A mirror with two crates, as crates.io lays them out: <name>/<name>-<v>.crate.
MIRROR="$WORK/mirror"
crate() { # $1 name, $2 version
  mkdir -p "$WORK/make/$1-$2/src" "$MIRROR/$1"
  printf '// %s %s\n' "$1" "$2" >"$WORK/make/$1-$2/src/lib.rs"
  tar -czf "$MIRROR/$1/$1-$2.crate" -C "$WORK/make" "$1-$2"
  sha256sum <"$MIRROR/$1/$1-$2.crate" | cut -d' ' -f1
}
alpha="$(crate alpha 1.0.0)"
beta="$(crate beta 0.2.0)"

FAKE="$WORK/repo"
mkdir -p "$FAKE/.github/scripts" "$FAKE/packages/domicile-engine/crates"
cp "$CRATES_SH" "$FAKE/.github/scripts/"
MANIFEST="$FAKE/packages/domicile-engine/crates/CRATES"
printf '# a comment\nalpha 1.0.0 alpha-v1 %s\nbeta 0.2.0 beta-v0_2 %s\n' \
  "$alpha" "$beta" >"$MANIFEST"

TREE="$WORK/chromium/src"
mkdir -p "$TREE/third_party/rust/chromium_crates_io/vendor/kept-v1"
echo kept >"$TREE/third_party/rust/chromium_crates_io/vendor/kept-v1/lib.rs"
gitq -C "$TREE" init -q
gitq -C "$TREE" add -A && gitq -C "$TREE" commit -qm pin

run() { DOMICILE_CRATES_URL="file://$MIRROR" "$FAKE/.github/scripts/engine-crates.sh" "$TREE"; }

VENDOR="$TREE/third_party/rust/chromium_crates_io/vendor"
out="$(run 2>&1)"
expect "the first run lays down both crates" "0" "$?"
expect "alpha's source is in its directory" "// alpha 1.0.0" "$(cat "$VENDOR/alpha-v1/src/lib.rs" 2>&1)"
expect "beta's source is in its directory" "// beta 0.2.0" "$(cat "$VENDOR/beta-v0_2/src/lib.rs" 2>&1)"
expect "the tree stays clean" "" "$(git -C "$TREE" status --porcelain)"
expect "Chromium's own crate stays" "kept" "$(cat "$VENDOR/kept-v1/lib.rs")"

touch -d '2000-01-01' "$VENDOR/alpha-v1/src/lib.rs"
out="$(run 2>&1)"
expect "a warm run says nothing" "" "$out"
expect "a warm run leaves the files' mtimes" "946684800" "$(stat -c %Y "$VENDOR/alpha-v1/src/lib.rs")"

printf 'alpha 1.0.0 alpha-v1 %s\n' "$alpha" >"$MANIFEST"
run >/dev/null 2>&1
expect "a crate CRATES drops is removed" "no" "$([ -d "$VENDOR/beta-v0_2" ] && echo yes || echo no)"
expect "and its exclude line goes" "0" \
  "$(grep -c beta "$(git -C "$TREE" rev-parse --absolute-git-dir)/info/exclude")"

printf 'alpha 1.0.0 alpha-v1 %s\nbeta 0.2.0 beta-v0_2 %s\n' \
  "$alpha" "0000000000000000000000000000000000000000000000000000000000000000" >"$MANIFEST"
out="$(run 2>&1)"
expect "a crate with the wrong sum fails the run" "1" "$?"
expect "and says which" "1" "$(grep -c 'beta-0.2.0.crate has sha256' <<<"$out")"
expect "and lays nothing down for it" "no" "$([ -d "$VENDOR/beta-v0_2" ] && echo yes || echo no)"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all passed"
