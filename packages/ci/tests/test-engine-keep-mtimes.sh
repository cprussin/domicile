#!/usr/bin/env bash
# Asserts that `engine-keep-mtimes.sh` gives back the old mtime of a file only
# when the file comes back with the same bytes.
#
# The reset and apply rewrite every patched file. Ninja rebuilds by mtime, so a
# rewritten file with unchanged bytes must get its old mtime back. A file whose
# bytes changed must keep its new mtime, or the build would miss the change.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
KEEP_SH="$ROOT/.github/scripts/engine-keep-mtimes.sh"
[ -x "$KEEP_SH" ] || { echo "no $KEEP_SH" >&2; exit 1; }

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

TREE="$WORK/chromium/src"
SNAPSHOT="$WORK/chromium/.domicile-kept-mtimes"
mkdir -p "$TREE/a"
keep() { "$KEEP_SH" "$@" 2>&1; }
mtime() { stat -c %.9Y "$TREE/$1"; }

# Files as a finished build leaves them, an hour in the past.
echo "same" >"$TREE/a/same.cc"
echo "old" >"$TREE/a/changed.cc"
echo "gone" >"$TREE/a/gone.cc"
touch -d '1 hour ago' "$TREE/a/same.cc" "$TREE/a/changed.cc" "$TREE/a/gone.cc"
before="$(mtime a/same.cc)"

printf '%s\n' a/same.cc a/changed.cc a/gone.cc a/missing.cc ../outside.cc /abs.cc |
  keep save "$TREE" >/dev/null
expect "save writes the snapshot beside the checkout" yes \
  "$([ -d "$SNAPSHOT" ] && echo yes || echo no)"

# What the reset and apply do: rewrite every file, change one, drop one.
echo "same" >"$TREE/a/same.cc"
echo "new" >"$TREE/a/changed.cc"
rm "$TREE/a/gone.cc"
rewritten="$(mtime a/changed.cc)"

out="$(keep restore "$TREE")"
expect "restore succeeds" 0 "$?"
expect "an unchanged file gets its old mtime back" "$before" "$(mtime a/same.cc)"
expect "a changed file keeps its new mtime" "$rewritten" "$(mtime a/changed.cc)"
expect "a file the series dropped stays gone" no \
  "$([ -e "$TREE/a/gone.cc" ] && echo yes || echo no)"
expect "restore removes the snapshot, so it is used once" no \
  "$([ -e "$SNAPSHOT" ] && echo yes || echo no)"
case "$out" in
  (*"1 of"*) printf '  ok    %s\n' "restore says how many it kept" ;;
  (*) printf '  FAIL  restore says how many it kept\n    said: %s\n' "$out"; FAILED=$((FAILED + 1)) ;;
esac

# Without a snapshot there is nothing to give back, and nothing is touched.
touch -d '2 hours ago' "$TREE/a/same.cc"
untouched="$(mtime a/same.cc)"
keep restore "$TREE" >/dev/null
expect "restore without a snapshot succeeds" 0 "$?"
expect "and touches nothing" "$untouched" "$(mtime a/same.cc)"

# `drop` forgets a snapshot, for an apply that failed part way.
printf 'a/same.cc\n' | keep save "$TREE" >/dev/null
keep drop "$TREE" >/dev/null
expect "drop removes the snapshot" no \
  "$([ -e "$SNAPSHOT" ] && echo yes || echo no)"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all ok"
