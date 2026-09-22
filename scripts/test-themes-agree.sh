#!/usr/bin/env bash
# One closed set of two, written down in six places, compared.
#
# A config says `[theme] mode = "light"` and the word crosses five boundaries
# to become a class on `<html>`: `domicile_config::ThemeMode` parses the file,
# the compositor serializes `domicile_protocol::Theme`, the browser process
# parses it against `components/domicile/common/theme.h` into `mojom::Theme`,
# Blink hands the page a `DomicileTheme` out of `domicile_theme.idl`, and the
# SDK reads the name back through `themeSchema` in `theme.ts`. Six
# enumerations of one set, in Rust twice, C++, mojom, WebIDL and TypeScript.
#
# The sibling of `test-cursor-shapes-agree.sh` and `test-display-transforms-
# agree.sh`, and the one whose set crosses in BOTH directions: a shell's
# toggle calls `setTheme()`, so a name that five lists spell one way and the
# sixth spells another is refused going out as well as coming in.
#
# WHAT DRIFT COSTS HERE. Both codecs refuse a name they do not know -- there
# is no fallback, because a theme picked by a typo is a decision rather than a
# missing reading -- so the failure is a desk whose toggle does nothing, or a
# desk that comes up in dark having been configured light, in both cases with
# one dropped message and no error anywhere a user can see.
#
# TWO MEMBERS, WHICH IS WHY THE COUNT BELOW IS 2 AND NOT 5. That is also the
# thing most likely to change and the change most worth catching: a `system`
# added on one side is exactly the member Domicile refuses to have, because
# Domicile is the system.
#
# ORDER, NOT JUST MEMBERSHIP, for the reason the cursor script gives: the
# mojom is an `enum class : int32_t` whose numbering comes from position, so
# two lists that agree on membership and disagree on order do not fail. They
# paint the desk the wrong way round.
#
# BUILDLESS ON PURPOSE, like its siblings: nothing here compiles anything, and
# the failure it catches would otherwise surface as an engine build on the one
# runner that can do it, or not at all.
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

# The two Rust lists. Neither spells its wire names out: both lean on serde's
# `rename_all`, which for one-word variants is the variant lowercased and so is
# exactly the wire name. Derived rather than read for that reason -- there is
# nothing to read -- which is the opposite of what the transform script does,
# and the difference is that `Rotate270` is two words to a human and one to
# serde. `Dark` and `Light` are one word to both.
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

# C++: the second argument of each X-macro entry, which IS the wire name.
sed -n 's/^  X([A-Za-z0-9]*, "\([^"]*\)").*/\1/p' "$CPP" >"$WORK/cpp"

# mojom: the enumerators of `enum Theme`, lowercased the way the C++ list
# pairs them. Derived rather than read, because the mojom has no strings in it
# at all: what it contributes to this comparison is the ORDER, which is what
# its int32 numbering is.
sed -n '/^enum Theme {$/,/^};$/p' "$MOJOM" |
  sed -n 's/^  k\([A-Za-z0-9]*\),$/\1/p' |
  tr '[:upper:]' '[:lower:]' >"$WORK/mojom"

# WebIDL: the quoted members of `enum DomicileTheme`.
sed -n '/^enum DomicileTheme {$/,/^};$/p' "$IDL" |
  sed -n 's/^  "\([^"]*\)",$/\1/p' >"$WORK/idl"

# TypeScript: the members of the Zod enum, however the formatter chose to
# break it. Its siblings read `^  "name",$` off their own line, which works
# there and would read nothing here: two short members fit on one line, so
# biome writes `z.enum(["dark", "light"])` and a line-anchored pattern comes
# back empty -- which the count below would catch, but only after somebody
# reformatted an unrelated file. The strings between the brackets are the list
# either way round.
sed -n '/themeSchema = z.enum(\[/,/\]);/p' "$TS" |
  grep -o '"[^"]*"' | tr -d '"' >"$WORK/ts"

FAILED=0
for f in protocol config cpp mojom idl ts; do
  n="$(wc -l <"$WORK/$f" | tr -d ' ')"
  # A pattern that stops matching reads as an empty list, and an empty list
  # compares equal to another empty list. That is this script failing open --
  # the shape of bug it exists to catch, one level up -- so the count is
  # asserted before anything is compared. Two, exactly: a desktop has a dark
  # and a light and nothing else, and a third member is the thing this script
  # is most likely to be asked to wave through.
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
