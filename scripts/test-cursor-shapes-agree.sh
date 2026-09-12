#!/usr/bin/env bash
# One closed set, written down in three languages, compared.
#
# A client asks for a cursor and the name crosses two boundaries to reach CSS:
# the compositor serialises `domicile_protocol::CursorShape`, the browser
# process parses it against `components/domicile/common/cursor_shape.h`, and
# the page reads it through `cursorShapeSchema` in `@domicile/chrome-sdk`.
# Three enumerations of the same set, in Rust, C++ and TypeScript, and until
# this script existed NOTHING COMPARED THEM.
#
# What drift costs is the whole reason the set was closed in the first place.
# A keyword CSS does not know is not an error anywhere -- `element.style.cursor
# = "pointr"` is a no-op -- so a shape the compositor can send and the browser
# cannot parse is an arrow where a hand should be, over one client, with
# nothing said. Closing the set at each boundary made each end refuse a name it
# does not know; it did not make the three ends agree about WHICH names those
# are. A shape added to two of them and forgotten in the third is refused at
# the boundary that never heard of it, which reads as the client's fault.
#
# ORDER, NOT JUST MEMBERSHIP. `cursor_shape.h` says its order matches
# `domicile_protocol::CursorShape` and `mojom::CursorShape`, and the mojom is
# an `enum class : int32_t` whose numbering comes from position. A set that
# agrees on membership and disagrees on order is the worse bug of the two: it
# does not fail, it silently shows the wrong cursor.
#
# BUILDLESS ON PURPOSE. Nothing here compiles anything. The failure this
# catches would otherwise surface as a ~50 minute engine build on the one
# runner that can do it, or not at all -- and a session without a Chromium
# checkout (every Claude web session) cannot run that build at any price.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUST="$ROOT/packages/domicile-protocol/src/lib.rs"
CPP="$ROOT/packages/domicile-engine/src/components/domicile/common/cursor_shape.h"
TS="$ROOT/packages/chrome-sdk/src/cursor-shape.ts"

for f in "$RUST" "$CPP" "$TS"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Rust: the variants of `pub enum CursorShape`, kebab-cased the way
# `#[serde(rename_all = "kebab-case")]` does it -- a hyphen before every
# capital except the first CHARACTER, then lowered. Not "before a capital that
# follows a lower-case letter", which is the plausible version and is wrong:
# it leaves `EResize` as `eresize` while serde writes `e-resize`, and the four
# single-letter compass shapes are exactly the ones it gets wrong. That attribute is read here rather than assumed:
# if it ever changes, these names are no longer the wire's and this comparison
# is against the wrong thing.
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

# C++: the second argument of each X-macro entry, which IS the wire name.
sed -n 's/^  X([A-Za-z]*, "\([^"]*\)").*/\1/p' "$CPP" >"$WORK/cpp"

# TypeScript: the members of the Zod enum.
sed -n '/cursorShapeSchema = z.enum(\[/,/\]);/p' "$TS" |
  sed -n 's/^  "\([^"]*\)",$/\1/p' >"$WORK/ts"

FAILED=0
for f in rust cpp ts; do
  n="$(wc -l <"$WORK/$f" | tr -d ' ')"
  # A pattern that stops matching reads as an empty list, and an empty list
  # compares equal to another empty list. That is this script failing open --
  # the shape of bug it exists to catch, one level up -- so the count is
  # asserted before anything is compared.
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
compare "the browser's shapes are the page's, in the same order" \
  "$WORK/cpp" "$WORK/ts"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
