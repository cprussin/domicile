#!/usr/bin/env bash
# Asserts each element the fork defines overrides `GetElementType()` with its
# own type.
#
# Blink's `DynamicTo<T>` checks `DowncastTraits<T>::AllowFrom`, which for an
# element in `html_tag_names.json5` is generated as
#
#   node.GetElementType() == ElementType::kHTMLAppElement
#
# `HTMLElement` returns `kHTMLElement` by default, so an element without the
# override works normally but every cast to it returns null. The compiler
# cannot catch this, since the traits and enum member both exist. `node.h`
# states the rule but nothing enforces it.
#
# Without the override on `<app>`, `LayoutAppSurface::UpdateAfterLayout`'s cast
# fails, the window is never sized or embedded, and `guard-shell.sh` fails with
# no pixels and no log.
#
# Reads the elements from the patch that adds them to `html_tag_names.json5`
# and checks each header. Needs no Chromium tree.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERIES="$ROOT/packages/domicile-engine"
SRC="$SERIES/src"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# Every `interfaceName:` the series adds to html_tag_names.json5, in patch
# order. Reads only that file's diff, since other json5 files also use
# `interfaceName`.
fork_elements() {
  awk '
    /^diff --git a\// { in_tags = ($0 ~ /html_tag_names\.json5$/) }
    in_tags && /^\+[[:space:]]*interfaceName:/ {
      if (match($0, /"[^"]+"/)) {
        print substr($0, RSTART + 1, RLENGTH - 2)
      }
    }
  ' "$SERIES"/patches/*.patch | sort -u
}

ELEMENTS="$(fork_elements)"

# An empty list would pass every check below, so a renamed patch or a
# reformatted json5 block must fail here instead.
if [ -z "$ELEMENTS" ]; then
  echo "no elements found in the series' html_tag_names.json5 hunks" >&2
  echo "either the fork defines none, or this script has stopped reading them" >&2
  exit 1
fi
echo "the fork defines $(printf '%s\n' "$ELEMENTS" | wc -l) element(s):"

for element in $ELEMENTS; do
  header="$(grep -rl "class CORE_EXPORT $element " "$SRC" --include='*.h' || true)"
  if [ -z "$header" ]; then
    fail "$element has a header in src/" \
      "nothing under src/ declares 'class CORE_EXPORT $element'"
    continue
  fi
  # Exactly one header, so the check knows which one it read.
  if [ "$(printf '%s\n' "$header" | wc -l)" -ne 1 ]; then
    fail "$element is declared once" \
      "more than one header declares it: $(printf '%s\n' "$header" | paste -sd, -)"
    continue
  fi

  # Check the override and its return value together: returning another
  # element's type makes casts succeed onto the wrong class.
  if grep -qE "ElementType[[:space:]]+GetElementType\(\)[[:space:]]+const[[:space:]]+(final|override)" "$header" &&
     grep -qE "return[[:space:]]+ElementType::k$element;" "$header"; then
    ok "$element says it is ElementType::k$element"
  else
    fail "$element says which element it is" \
      "$(basename "$header") has no 'GetElementType() const final { return ElementType::k$element; }', so every DynamicTo<$element> returns null"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
