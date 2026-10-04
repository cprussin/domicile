#!/usr/bin/env bash
# Checks that the five display transform lists agree, in order.
#
# A transform name crosses the config (`domicile_config::Transform`), the
# compositor (`domicile_protocol::DisplayTransform`), the browser
# (`components/domicile/common/display_transform.h`), mojom
# (`mojom::DisplayTransform`) and the SDK (`displayTransformSchema`).
#
# An unknown name falls back to `normal` instead of dropping the whole display
# list, so drift silently draws a monitor unrotated. The mojom numbers by
# position, so order matters too.
#
# There is no WebIDL list: `DomicileDisplay.transform` is a `DOMString` (see
# `domicile_display.idl`). Like `test-cursor-shapes-agree.sh`, this builds
# nothing.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROTOCOL="$ROOT/packages/domicile-protocol/src/lib.rs"
CONFIG="$ROOT/packages/domicile-config/src/profile.rs"
CPP="$ROOT/packages/domicile-engine/src/components/domicile/common/display_transform.h"
MOJOM="$ROOT/packages/domicile-engine/src/components/domicile/mojom/control_channel.mojom"
TS="$ROOT/packages/chrome-sdk/src/display-transform.ts"

for f in "$PROTOCOL" "$CONFIG" "$CPP" "$MOJOM" "$TS"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Rust: the `#[serde(rename = "...")]` on each variant is the wire name. Both
# enums spell names by hand, because `rename_all = "kebab-case"` would write
# `rotate270`. If they switch to `rename_all`, this reads nothing and fails the
# count check.
renames() { # file, enum name
  awk -v want="pub enum $2 {" '
    index($0, want) { inside = 1; next }
    inside && /^\}/ { exit }
    inside && match($0, /#\[serde\(rename = "[^"]*"\)\]/) {
      line = substr($0, RSTART, RLENGTH)
      match(line, /"[^"]*"/)
      print substr(line, RSTART + 1, RLENGTH - 2)
    }' "$1"
}
renames "$PROTOCOL" DisplayTransform >"$WORK/protocol"
renames "$CONFIG" Transform >"$WORK/config"

# C++: the second argument of each X-macro entry is the wire name.
sed -n 's/^  X([A-Za-z0-9]*, "\([^"]*\)").*/\1/p' "$CPP" >"$WORK/cpp"

# mojom: the enumerators of `enum DisplayTransform`, mapped to wire names as
# the C++ list pairs them (`kRotate90` is `rotate-90`). The mojom has no
# strings; it contributes the order.
sed -n '/^enum DisplayTransform {$/,/^};$/p' "$MOJOM" |
  sed -n 's/^  k\([A-Za-z0-9]*\),$/\1/p' |
  sed -E 's/([a-z])([0-9])/\1-\2/' |
  tr '[:upper:]' '[:lower:]' >"$WORK/mojom"

# TypeScript: the members of the Zod enum.
sed -n '/displayTransformSchema = z.enum(\[/,/\]);/p' "$TS" |
  sed -n 's/^  "\([^"]*\)",$/\1/p' >"$WORK/ts"

FAILED=0
for f in protocol config cpp mojom ts; do
  n="$(wc -l <"$WORK/$f" | tr -d ' ')"
  # A pattern that stops matching yields an empty list, which equals any
  # other empty list. Check the count first.
  if [ "$n" -lt 2 ]; then
    printf '  FAIL  read %s turns from the %s list, so its pattern no longer matches\n' \
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

echo "  ($(wc -l <"$WORK/cpp" | tr -d ' ') turns)"
compare "the config file's turns are the compositor's, in the same order" \
  "$WORK/config" "$WORK/protocol"
compare "the compositor's turns are the browser's, in the same order" \
  "$WORK/protocol" "$WORK/cpp"
compare "the browser's turns are the mojom's, in the same order" \
  "$WORK/cpp" "$WORK/mojom"
compare "the browser's turns are the page's, in the same order" \
  "$WORK/cpp" "$WORK/ts"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
