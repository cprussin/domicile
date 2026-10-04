#!/usr/bin/env bash
# Checks that the four cursor shape lists agree, in order.
#
# A shape name crosses the compositor (`domicile_protocol::CursorShape`), the
# browser (`components/domicile/common/cursor_shape.h`), WebIDL
# (`DomicileCursorShape`) and the SDK (`cursorShapeSchema`). Each end refuses
# names it does not know, so a shape missing from one is silently an arrow.
#
# Order matters too: the mojom enum numbers by position, so a reordering shows
# the wrong cursor without failing.
#
# This builds nothing, so it runs without a Chromium checkout.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST="$ROOT/packages/domicile-protocol/src/lib.rs"
CPP="$ROOT/packages/domicile-engine/src/components/domicile/common/cursor_shape.h"
IDL="$ROOT/packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/domicile_cursor_shape.idl"
TS="$ROOT/packages/chrome-sdk/src/cursor-shape.ts"

for f in "$RUST" "$CPP" "$IDL" "$TS"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Rust: the variants of `pub enum CursorShape`, kebab-cased as
# `#[serde(rename_all = "kebab-case")]` does: a hyphen before every capital
# except the first character, then lowercased. So `EResize` is `e-resize`.
# Check the attribute, since the wire names depend on it.
grep -q 'rename_all = "kebab-case"' "$RUST" || {
  echo "  FAIL  $RUST no longer renames CursorShape to kebab-case," >&2
  echo "        so the wire names are not what this script derives." >&2
  exit 1
}
awk '/^pub enum CursorShape \{/ { inside = 1; next }
     inside && /^\}/ { exit }
     inside && /^    [A-Z][A-Za-z]*,$/ { gsub(/[ ,]/, ""); print }' "$RUST" |
  sed -E 's/(.)([A-Z])/\1-\2/g' |
  tr '[:upper:]' '[:lower:]' >"$WORK/rust"

# C++: the second argument of each X-macro entry is the wire name.
sed -n 's/^  X([A-Za-z]*, "\([^"]*\)").*/\1/p' "$CPP" >"$WORK/cpp"

# WebIDL: the quoted members of `enum DomicileCursorShape`. The bindings ignore
# their order, but it matches the others so the comparison is one diff.
sed -n '/^enum DomicileCursorShape {$/,/^};$/p' "$IDL" |
  sed -n 's/^  "\([^"]*\)",$/\1/p' >"$WORK/idl"

# TypeScript: the members of the Zod enum.
sed -n '/cursorShapeSchema = z.enum(\[/,/\]);/p' "$TS" |
  sed -n 's/^  "\([^"]*\)",$/\1/p' >"$WORK/ts"

FAILED=0
for f in rust cpp idl ts; do
  n="$(wc -l <"$WORK/$f" | tr -d ' ')"
  # A pattern that stops matching yields an empty list, which equals any
  # other empty list. Check the count first.
  if [ "$n" -lt 2 ]; then
    printf '  FAIL  read %s shapes from the %s list, so its pattern no longer matches\n' \
      "$n" "$f"
    FAILED=$((FAILED + 1))
  fi
done
[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }

compare() { # what, file a, file b
  if diff -u "$2" "$3" >"$WORK/diff"; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n' "$1"
    sed 's/^/    /' "$WORK/diff"
    FAILED=$((FAILED + 1))
  fi
}

echo "  ($(wc -l <"$WORK/cpp" | tr -d ' ') shapes)"
compare "the compositor's shapes are the browser's, in the same order" \
  "$WORK/rust" "$WORK/cpp"
compare "the browser's shapes are the engine's, in the same order" \
  "$WORK/cpp" "$WORK/idl"
compare "the engine's shapes are the page's, in the same order" \
  "$WORK/idl" "$WORK/ts"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
