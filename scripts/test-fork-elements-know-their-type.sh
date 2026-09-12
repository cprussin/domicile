#!/usr/bin/env bash
# Whether the elements the fork defines say which element they are.
#
# Blink does not downcast a Node by its C++ type. `DynamicTo<T>` asks
# `DowncastTraits<T>::AllowFrom`, and for an element in `html_tag_names.json5`
# that is generated as
#
#   node.GetElementType() == ElementType::kHTMLAppElement
#
# against a virtual on Node that every element must override for itself.
# `HTMLElement`'s base returns `kHTMLElement`, so an element that forgets the
# override is a perfectly ordinary, fully working element that **no cast ever
# succeeds on** — and the compiler cannot say so, because the generated traits
# and the enum member both exist. `node.h` states the rule and nothing enforces
# it: "every HTMLElement must override this so that callers can ask for the
# type".
#
# WHAT IT COST TO LEARN THAT. `<app>` shipped without it. The element parsed,
# got an `HTMLAppElement` wrapper, took a box, laid out at the right size and
# reflected `app-id` — everything a page can see was right. But
# `LayoutAppSurface::UpdateAfterLayout` casts the node back to `HTMLAppElement`
# to hand it the box, that cast returned null, so `SurfaceBoxChanged` was never
# called, `configured_size_` stayed empty, and `Embed()` returned at its
# empty-size guard on every layout. A window that is never asked for is a
# window that never arrives: `guard-shell.sh` failed with no pixels and nothing
# in any log to say why, because nothing had gone wrong — a cast had quietly
# said no.
#
# `<webview>` shipped without it too, and that one was *seen*: patch 0011 read
# `DynamicTo<HTMLWebViewElement>` returning null out of a real click, wrote the
# anomaly down, worked around it with `HasTagName` and concluded the traits
# "work for <app>". They did not. One missing line, two elements, and two
# separate days spent somewhere else.
#
# So: read the elements the fork adds to `html_tag_names.json5` out of the
# patch that adds them, and check each one's header says its own type. No
# Chromium tree needed — the patch is the list, and the header is beside it.
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
# order. Scoped to that file's own diff: `interfaceName` appears in other
# json5 files and reading them all would check headers this rule does not
# govern.
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

# THE POSITIVE FIRST, and it is the whole reason this cannot fail open: an
# empty list passes every check below vacuously, so a renamed patch or a
# reformatted json5 block would turn this into a green no-op — which is the
# same silence the bug itself arrived in.
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
  # One header, or the check does not know which it read.
  if [ "$(printf '%s\n' "$header" | wc -l)" -ne 1 ]; then
    fail "$element is declared once" \
      "more than one header declares it: $(printf '%s\n' "$header" | paste -sd, -)"
    continue
  fi

  # The override and the value it returns, together: an override that returns
  # some other element's type is worse than none, because it makes a cast
  # succeed onto the wrong class.
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
