#!/usr/bin/env bash
# Step 4 of the spike in docs/architecture/ENGINE-FORK.md: the measurement.
#
#   NIX_SHELL_RUN=".../scripts/spike-step4.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Inside the toolchain shell, like everything else here: a component build links
# against that shell's glibc and will not start without it.
#
# Two runs of spike.sh, because they need different pages:
#
#   css     seven cells, each one CSS property applied to an <app> and to an
#           ordinary <div> laid out identically beside it, plus the latency
#           from the producer's submit to the display compositor's output
#   resize  the embedder's box changing and the producer being reconfigured to
#           match. On its own page because every <app> in a document shares one
#           surface here, so bumping its LocalSurfaceId strands the others
#
# Exits 0 only if both do. A property that fails is the most valuable result
# there is, so nothing here works around one.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-step4.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

# One colour reaches both halves of the measurement: the producer submits it and
# the page fills every control element with it. There is no channel from a page
# to the producer, so this is what makes them agree.
COLOR="${COLOR:-00C853}"

# Must match spike-resize-page.html.
RESIZE_FROM="${RESIZE_FROM:-120x90}"
RESIZE_TO="${RESIZE_TO:-180x130}"

# Big enough for the eight cells css_parity_layout.h lays out, with room for
# whatever the browser puts above the viewport.
WINDOW="${WINDOW:-1200,1000}"

FAILED=0

echo "=== CSS parity ==="
PRODUCER=domicile_css_parity \
PAGE="$SCRIPTS/spike-css-page.html" \
PAGE_QUERY="?color=$COLOR" \
WINDOW_SIZE="$WINDOW" \
  "$SCRIPTS/spike.sh" "$CHROMIUM" -- \
    "--check=css" "--color=FF$COLOR" || FAILED=1

echo
echo "=== resize ==="
PRODUCER=domicile_css_parity \
PAGE="$SCRIPTS/spike-resize-page.html" \
PAGE_QUERY="?color=$COLOR" \
WINDOW_SIZE="$WINDOW" \
SOCKET="${SOCKET:-/tmp/domicile-spike-resize}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-resize-profile}" \
  "$SCRIPTS/spike.sh" "$CHROMIUM" -- \
    "--check=resize" "--color=FF$COLOR" \
    "--resize-from=$RESIZE_FROM" "--resize-to=$RESIZE_TO" || FAILED=1

echo
if [ $FAILED -eq 0 ]; then
  echo "step 4: every property behaves as it does on an ordinary element"
else
  echo "step 4: FAILED — see the cells marked FAIL above" >&2
fi
exit $FAILED
