#!/usr/bin/env bash
# Checks that the six definitions of the theme set (dark, light) agree in
# members and order.
#
# The definitions:
#   - `domicile_config::ThemeMode` (Rust, config file)
#   - `domicile_protocol::Theme` (Rust, compositor)
#   - `components/domicile/common/theme.h` (C++, browser)
#   - `control_channel.mojom` `enum Theme`
#   - `domicile_theme.idl` (WebIDL)
#   - `themeSchema` in `chrome-sdk/src/theme.ts`
#
# Both codecs reject unknown names, so a mismatch drops the theme message
# silently: the toggle does nothing, or the desktop starts in the wrong theme.
# Order matters because the mojom enum is numbered by position.
#
# Siblings: `test-cursor-shapes-agree.sh`, `test-display-transforms-agree.sh`.
# Nothing is built, so this runs anywhere.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROTOCOL="$ROOT/packages/domicile-protocol/src/lib.rs"
CONFIG="$ROOT/packages/domicile-config/src/lib.rs"
CPP="$ROOT/packages/domicile-engine/src/components/domicile/common/theme.h"
MOJOM="$ROOT/packages/domicile-engine/src/components/domicile/mojom/control_channel.mojom"
IDL="$ROOT/packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/domicile_theme.idl"
TS="$ROOT/packages/chrome-sdk/src/theme.ts"

for f in "$PROTOCOL" "$CONFIG" "$CPP" "$MOJOM" "$IDL" "$TS"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The Rust lists rely on serde's `rename_all`, so the wire name is the variant
# lowercased.
variants() { # file, enum name
  awk -v want="pub enum $2 {" '
    index($0, want) { inside = 1; next }
    inside && /^\}/ { exit }
    inside && match($0, /^    [A-Z][A-Za-z0-9]*,$/) {
      line = $0
      gsub(/[ ,]/, "", line)
      print tolower(line)
    }' "$1"
}
variants "$PROTOCOL" Theme >"$WORK/protocol"
variants "$CONFIG" ThemeMode >"$WORK/config"

# C++: the second argument of each X-macro entry is the wire name.
sed -n 's/^  X([A-Za-z0-9]*, "\([^"]*\)").*/\1/p' "$CPP" >"$WORK/cpp"

# mojom: the `enum Theme` enumerators, lowercased. The mojom has no strings;
# it contributes the order.
sed -n '/^enum Theme {$/,/^};$/p' "$MOJOM" |
  sed -n 's/^  k\([A-Za-z0-9]*\),$/\1/p' |
  tr '[:upper:]' '[:lower:]' >"$WORK/mojom"

# WebIDL: the quoted members of `enum DomicileTheme`.
sed -n '/^enum DomicileTheme {$/,/^};$/p' "$IDL" |
  sed -n 's/^  "\([^"]*\)",$/\1/p' >"$WORK/idl"

# TypeScript: the strings in the Zod enum. Biome may put the whole enum on one
# line, so don't anchor to one member per line.
sed -n '/themeSchema = z.enum(\[/,/\]);/p' "$TS" |
  grep -o '"[^"]*"' | tr -d '"' >"$WORK/ts"

FAILED=0
for f in protocol config cpp mojom idl ts; do
  n="$(wc -l <"$WORK/$f" | tr -d ' ')"
  # An unmatched pattern yields an empty list, and two empty lists compare
  # equal. Assert the count first. A third theme (e.g. `system`) is
  # intentionally refused.
  if [ "$n" -ne 2 ]; then
    printf '  FAIL  read %s themes from the %s list, which should be 2\n' \
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

echo "  ($(wc -l <"$WORK/cpp" | tr -d ' ') themes)"
compare "the config file's themes are the compositor's, in the same order" \
  "$WORK/config" "$WORK/protocol"
compare "the compositor's themes are the browser's, in the same order" \
  "$WORK/protocol" "$WORK/cpp"
compare "the browser's themes are the mojom's, in the same order" \
  "$WORK/cpp" "$WORK/mojom"
compare "the browser's themes are the bindings', in the same order" \
  "$WORK/cpp" "$WORK/idl"
compare "the bindings' themes are the page's, in the same order" \
  "$WORK/idl" "$WORK/ts"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
