#!/usr/bin/env bash
# One closed set, written down in five places, compared.
#
# A config says a monitor is on its side and the name crosses four boundaries
# to become a CSS transform: `domicile_config::Transform` parses the file, the
# compositor serializes `domicile_protocol::DisplayTransform`, the browser
# process parses it against
# `components/domicile/common/display_transform.h` into
# `mojom::DisplayTransform`, and the SDK reads the name back off
# `DomicileDisplay.transform` through `displayTransformSchema` in
# `display-transform.ts` in `@domicile/chrome-sdk`. Five enumerations of one
# set, in Rust twice, C++, mojom and TypeScript.
#
# The sibling of `test-cursor-shapes-agree.sh`, and what drift costs here is
# worse than there. A cursor nobody knows is refused at the boundary that
# never heard of it, which at least stops. A TURN nobody knows falls back to
# `normal` -- deliberately, because refusing it would drop the whole desktop
# description and leave a shell with no screens -- so a name that four lists
# spell one way and the fifth spells another is a monitor drawn face-up on its
# side, silently, with the desk otherwise working.
#
# ORDER, NOT JUST MEMBERSHIP, for the reason the cursor script gives: the mojom
# is an `enum class : int32_t` whose numbering comes from position, so two
# lists that agree on membership and disagree on order do not fail. They turn
# a monitor the wrong way.
#
# There is no WebIDL list here, and that is not an omission.
# `DomicileDisplay.transform` is a `DOMString` rather than a generated enum --
# `domicile_display.idl` says why -- so the engine has nothing to enumerate and
# the browser's list is handed to the page as a string.
#
# BUILDLESS ON PURPOSE, like its sibling: nothing here compiles anything, and
# the failure it catches would otherwise surface as an engine build on the one
# runner that can do it, or not at all.
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

# The two Rust lists: the `#[serde(rename = "...")]` inside each enum, which IS
# the wire name. Read rather than derived, unlike the cursor script's, because
# both of these spell their names out by hand -- serde's kebab-case reads
# `Rotate270` as one word and writes `rotate270`, which is neither what the
# config file says nor what `wl_output` is called anywhere. A list that went
# back to `rename_all` would therefore be a list of different names, and this
# pattern would read nothing from it and fail on the count below.
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

# C++: the second argument of each X-macro entry, which IS the wire name.
sed -n 's/^  X([A-Za-z0-9]*, "\([^"]*\)").*/\1/p' "$CPP" >"$WORK/cpp"

# mojom: the enumerators of `enum DisplayTransform`, turned into wire names the
# way the C++ list pairs them -- `kRotate90` is `rotate-90`. Derived rather
# than read, because the mojom has no strings in it at all: what it contributes
# to this comparison is the ORDER, which is what its int32 numbering is.
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
  # A pattern that stops matching reads as an empty list, and an empty list
  # compares equal to another empty list. That is this script failing open --
  # the shape of bug it exists to catch, one level up -- so the count is
  # asserted before anything is compared.
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
