#!/usr/bin/env bash
# Checks that the pages behind
# docs/architecture/ENGINE-FORK-MEASUREMENTS.md#css-parity embed windows with
# the native `<app>` element, as shells do.
#
# The canvas embed method is a path no shell takes, so measuring through it
# describes something else and fails nowhere. See also
# scripts/test-fork-elements-know-their-type.sh.
#
# Through `<app>`, a resize needs no call: `LayoutAppSurface` reports the new
# box and the element re-embeds.
#
# Other pages (spike-page.html, guard-two-windows.html, the iframe pages)
# still use the canvas path on purpose, so this lists its pages explicitly.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
PAGES="spike-css-page.html spike-resize-page.html"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A grep over a missing file looks like a pass, so require each page first.
for page in $PAGES; do
  if [ ! -f "$SCRIPTS/$page" ]; then
    echo "no page at $SCRIPTS/$page" >&2
    echo "either the parity measurement has moved, or this script has" >&2
    echo "stopped being able to find it" >&2
    exit 1
  fi
done
echo "the parity measurement is: $PAGES"

for page in $PAGES; do
  PAGE="$SCRIPTS/$page"
  echo "$page:"

  # Match the tag and the app id together: an `<app>` without an app id
  # requests no window. The CSS page builds its cells in script (see CELLS and
  # css_parity_layout.h), and the resize page writes its cell in markup.
  #
  # Neither pattern matches `<app>` in prose, which appears in every page's
  # comments.
  if grep -qE "createElement\(['\"]app['\"]\)" "$PAGE" &&
     grep -qE "setAttribute\(['\"]app-id['\"]" "$PAGE"; then
    ok "the element under test is an <app>, built in script, naming a window"
  elif grep -qE "<app[[:space:]][^>]*app-id=" "$PAGE"; then
    ok "the element under test is an <app>, written in markup, naming a window"
  else
    fail "the element under test is an <app> naming a window" \
      "the page neither creates an <app> and sets app-id on it nor writes <app app-id=…>, so the table it feeds is not measuring the element a shell writes"
  fi

  # A page could write an `<app>` and still measure through the canvas. Match
  # the call, not the name, so comments explaining the canvas path are allowed.
  if grep -q 'embedExternalSurface(' "$PAGE"; then
    fail "it does not reach for the canvas path" \
      "embedExternalSurface() is still called here, so what this page measures is the canvas rather than <app>"
  else
    ok "it does not reach for the canvas path"
  fi
done

# The producer uses the first embed's size as the configured size. Sized only
# by script, the `<app>` was sometimes laid out first at the 300x150 default
# and failed the guard. The stylesheet must set the starting size.
RESIZE="$SCRIPTS/spike-resize-page.html"
if awk '
  /^[[:space:]]*#app[[:space:]]*,?[^{]*\{/ { in_rule = 1 }
  in_rule && /width:[[:space:]]*120px/ { width = 1 }
  in_rule && /height:[[:space:]]*90px/ { height = 1 }
  in_rule && /\}/ { in_rule = 0 }
  END { exit (width && height ? 0 : 1) }
' "$RESIZE"; then
  ok "the resize page lays its <app> out at 120x90 before its script runs"
else
  fail "the resize page lays its <app> out at 120x90 before its script runs" \
    "no #app rule in spike-resize-page.html's stylesheet sets width: 120px and height: 90px, so the first layout can embed at 300x150"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
