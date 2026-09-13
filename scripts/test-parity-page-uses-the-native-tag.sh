#!/usr/bin/env bash
# Whether the pages behind ENGINE-FORK.md's parity table embed a window the way
# a shell does.
#
# The table answers "does CSS treat an <app> like a <div>", and for that answer
# to be about anything the shells run, the element under test has to be the
# fork's native <app>. For most of this project's life it was not: every guard
# page reached a window through the canvas's own embed method, the SDK's
# <domicile-app> wrapped exactly that call, and the whole table was taken
# through it.
#
# The tag is native now and the wrapper is gone, so the canvas is a path no
# shell takes. A measurement through it is not wrong, it is about something
# else — and the difference does not show up as a failure anywhere, which is
# what makes it worth a check rather than a comment. `<app>` shipped broken for
# two days behind exactly this: every guard that passed drove the canvas, so
# the native element's own embed had never run, and patch 0011 cited the resize
# guard as proof of a cast that guard never exercised. See
# scripts/test-fork-elements-know-their-type.sh, which is the other half of
# that lesson.
#
# BOTH PAGES, and the resize one is in here for a reason the CSS one is not.
# "An <app>'s layout box *is* the xdg_toplevel.configure" is what the placement
# deletion in ROADMAP.md rests on, and through the canvas that row was a page
# calling embed a second time — a claim about a method, not about layout.
# Through the tag nothing calls anything: the box changes, LayoutAppSurface
# reports it, and the element re-embeds at the new size on its own.
#
# spike-page.html, guard-two-windows.html and the iframe pages still embed
# through the canvas and are still worth having — the canvas path is a
# supported one, and spike-iframe.sh compares against it on purpose. So this
# names the pages it governs rather than sweeping the directory.
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

# THE POSITIVE FIRST. Every check below is a grep over a file, and a grep over
# a file that is not there answers the same way as a grep over one that passes.
# A renamed or moved page would otherwise turn this into a green no-op, which
# is the silence the whole check exists to break.
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

  # THE TAG AND THE APP ID TOGETHER, in one pattern per spelling, because
  # neither half means anything alone. An <app> with no app-id never asks the
  # browser for a window, and an app-id on something else is a canvas being
  # told which window it is.
  #
  # Two spellings because there are two pages: the CSS page builds its eight
  # cells from a table in script — see the CELLS list, which
  # css_parity_layout.h is the other half of — and the resize page has one cell
  # and writes it in markup.
  #
  # Neither pattern matches prose, and that is deliberate rather than
  # incidental: `<app>` on its own appears in the comments of every page here,
  # including this check's own reasons for existing, so a pattern that admitted
  # it would pass on a page that only *talks* about the tag. The first version
  # of this check did exactly that.
  if grep -qE "createElement\(['\"]app['\"]\)" "$PAGE" &&
     grep -qE "setAttribute\(['\"]app-id['\"]" "$PAGE"; then
    ok "the element under test is an <app>, built in script, naming a window"
  elif grep -qE "<app[[:space:]][^>]*app-id=" "$PAGE"; then
    ok "the element under test is an <app>, written in markup, naming a window"
  else
    fail "the element under test is an <app> naming a window" \
      "the page neither creates an <app> and sets app-id on it nor writes <app app-id=…>, so the table it feeds is not measuring the element a shell writes"
  fi

  # And not the other path, which is the half a comment cannot enforce. A page
  # that writes an <app> and *also* embeds through a canvas would pass the
  # check above while still measuring the canvas.
  #
  # The call rather than the name: these pages explain in prose what they
  # stopped doing and why, and a check that could not tell the explanation from
  # the thing explained would forbid the comment that keeps the next person
  # from undoing the change.
  if grep -q 'embedExternalSurface(' "$PAGE"; then
    fail "it does not reach for the canvas path" \
      "embedExternalSurface() is still called here, so what this page measures is the canvas rather than <app>"
  else
    ok "it does not reach for the canvas path"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
