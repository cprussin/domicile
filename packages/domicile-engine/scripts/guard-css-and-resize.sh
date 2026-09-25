#!/usr/bin/env bash
# Step 4 of the spike in docs/architecture/ENGINE-FORK.md: the measurement.
#
#   NIX_SHELL_RUN=".../scripts/guard-css-and-resize.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Inside the toolchain shell, like everything else here: a component build links
# against that shell's glibc and will not start without it.
#
# Three runs of spike.sh, because they need different pages — or, for the
# middle one, the same page asked for something else:
#
#   css              eight cells — a baseline, one per CSS property, and a
#                    negative control — each applied to an <app> and to an
#                    ordinary <div> laid out identically beside it, plus the
#                    latency from the producer's submit to the display
#                    compositor's output
#   backdrop-filter  those same eight cells with a filtering element stacked
#                    over them, which is translucent chrome over a window. The
#                    filter reads the render pass aggregation has already drawn
#                    the window's quads into, so an <app> under one has to come
#                    out the same as a <div> under one — and the negative
#                    control is the filter itself, since an unfiltered run of
#                    this page is a run of the one above
#   resize           the embedder's box changing and the producer being
#                    reconfigured to match. On its own page because every <app>
#                    in a document shares one surface here, so bumping its
#                    LocalSurfaceId strands the others
#
# Exits 0 only if all three do. A property that fails is the most valuable
# result there is, so nothing here works around one.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: guard-css-and-resize.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

# One color reaches both halves of the measurement: the producer submits it and
# the page fills every control element with it. There is no channel from a page
# to the producer, so this is what makes them agree.
COLOR="${COLOR:-00C853}"

# Must match spike-resize-page.html.
RESIZE_FROM="${RESIZE_FROM:-120x90}"
RESIZE_TO="${RESIZE_TO:-180x130}"

# WHAT THE THIRD RUN PUTS OVER THE WINDOW, AND WHY IT IS NOT A BLUR. The
# verdict every cell is read by is on interior pixels, because a composited
# surface resamples its edges where a <div> rasterizes them — under software
# rasterization `transform` differs on 285 of them and on none inside. A blur
# is the one operation that carries those edge pixels into the interior of the
# region it filters, so a blurred run would read the rasterizer rather than the
# seam. A per-pixel filter maps each backdrop pixel where it stands, and an
# edge stays an edge.
#
# `invert(1)` over the window's flat color is also the largest difference a
# filter can make, which is what the negative control needs to see.
# `BACKDROP_FILTER='blur(8px)'` takes the blur measurement, and `GPU=1` is the
# run to take it on: on hardware every cell is 0, so there is nothing to
# spread. One token either way — it goes in a query string.
BACKDROP_FILTER="${BACKDROP_FILTER:-invert(1)}"

# WHAT THE PAGE HAS TO SAY, AND WHY ITS SILENCE IS A FAILURE. The filter is a
# query parameter on the CSS run's own page, so a page that does not read it
# lays out the plain table: every cell passes, and the run reports parity for a
# filter nothing ever applied. The page prints this once the engine has parsed
# the value and the cells carry it, and the run below is not a measurement
# without it.
FILTER_APPLIED="domicile: backdrop-filter $BACKDROP_FILTER is over"

# Big enough for the eight cells css_parity_layout.h lays out, with room for
# whatever the browser puts above the viewport.
WINDOW="${WINDOW:-1200,1000}"

FAILED=0

# Each run's output is kept apart from the others', because the verdict below
# is a statement about one run and reading it off the three of them says things
# that are true of none.
#
# `tee` rather than a plain redirect so a person running this by hand still
# sees it go by — in blocks rather than lines, because a pipe switches the
# producer's stdout from line-buffered to block-buffered, which also lets its
# unbuffered stderr overtake the table. CI redirected to a file and had both
# already. The verdict does not depend on the order, only on which run the
# line came from, but "its own last words are above" can be a line near the
# top of a run rather than the bottom of it.
CSS_LOG="${CSS_LOG:-/tmp/domicile-step4-css.log}"
BACKDROP_LOG="${BACKDROP_LOG:-/tmp/domicile-step4-backdrop.log}"
RESIZE_LOG="${RESIZE_LOG:-/tmp/domicile-step4-resize.log}"

# WHY THIS SCRIPT SAYS WHICH END, AND NOT THE WORKFLOW STEP THAT RUNS IT.
#
# The step used to grep the whole run and pick between three sentences, and
# review found it naming the wrong end three different ways: a resize that
# disagreed about its own boxes announced as "never got as far as a verdict", a
# seam failure in the resize run announced as "the instrument, not the seam"
# because the CSS run's probe had also stalled, and — measured, at about
# 128 KB of log — `grep -v … | grep -q …` losing to SIGPIPE under `pipefail`
# and routing a genuine cell failure to the catch-all.
#
# All three are the same mistake: classifying from evidence that does not
# establish the class. Here the three exit statuses are facts, each run's log
# is its own, and every sentence is about one run.
run_verdict() { # $1 that run's log
  # THE TABLE FIRST, always. `css_passed_` is decided before the latency phase
  # runs and the phase runs anyway, so a run can have both a failed cell and a
  # failed probe — and a renderer stalled enough to exhaust the poll budget is
  # exactly the kind of thing that also mismatches a cell. Asked the other way
  # round, this announces the instrument about a property that really did
  # behave differently.
  #
  # `FAIL($|[^E])` and not `FAIL`, because the summary this function feeds says
  # FAILED and would otherwise answer its own question.
  if grep -qE 'FAIL($|[^E])' "$1"; then
    echo "a cell is marked FAIL"
  # THE TWO `latency:` LINES ARE OPPOSITE ENDS, and one grep for the prefix
  # called both of them the instrument. `never appeared after N draws` means
  # the probe answered every time and a color the producer submitted never
  # reached the display compositor's output — which is the seam, and the most
  # serious result this whole script can produce.
  elif grep -q '^latency: .* never appeared after ' "$1"; then
    echo "every cell passed and then a color the producer submitted never reached the screen, which is the seam"
  elif grep -q '^latency: ' "$1"; then
    echo "every cell passed and the probe then stopped answering, which is the instrument rather than the seam"
  else
    # The producer prints its own reason — not embedded, the page and the
    # producer disagreeing about a box, a page that does not fit the window —
    # and there are more of those than a fourth sentence can be true of. So
    # this points at them instead of inventing one.
    echo "neither a cell nor the probe; its own last words are above"
  fi
}

echo "=== CSS parity ==="
PRODUCER=domicile_css_parity \
PAGE="$SCRIPTS/spike-css-page.html" \
PAGE_QUERY="?color=$COLOR&app=domicile-spike" \
WINDOW_SIZE="$WINDOW" \
  "$SCRIPTS/spike.sh" "$CHROMIUM" -- \
    "--check=css" "--color=FF$COLOR" 2>&1 | tee "$CSS_LOG"
CSS=${PIPESTATUS[0]}
[ "$CSS" -eq 0 ] || FAILED=1

echo
echo "=== backdrop-filter ==="
echo "the same eight cells, under $BACKDROP_FILTER"
# ENGINE_LOG is this run's own for the reason the resize run's is, and it is
# named here rather than written into the assignment because this is the one
# run that reads its engine log back: the page's own line is in it.
BACKDROP_ENGINE_LOG=/tmp/domicile-spike-backdrop-engine.log
PRODUCER=domicile_css_parity \
PAGE="$SCRIPTS/spike-css-page.html" \
PAGE_QUERY="?color=$COLOR&app=domicile-spike&backdrop-filter=$BACKDROP_FILTER" \
WINDOW_SIZE="$WINDOW" \
SOCKET="${SOCKET:-/tmp/domicile-spike-backdrop}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-backdrop-profile}" \
ENGINE_LOG="$BACKDROP_ENGINE_LOG" \
  "$SCRIPTS/spike.sh" "$CHROMIUM" -- \
    "--check=css" "--color=FF$COLOR" 2>&1 | tee "$BACKDROP_LOG"
BACKDROP=${PIPESTATUS[0]}
# THE TABLE CANNOT SAY WHETHER ANYTHING WAS FILTERED, and a page that ignored
# the parameter draws the run above: eight cells that pass, about a filter that
# was never there. So the page says what it did and this reads it back, and the
# sentence goes into this run's own log so the verdict below quotes it rather
# than inventing a fourth one.
if ! grep -qF "$FILTER_APPLIED" "$BACKDROP_ENGINE_LOG"; then
  echo "the page never said it applied $BACKDROP_FILTER, so nothing above was filtered" |
    tee -a "$BACKDROP_LOG" >&2
  BACKDROP=1
fi
[ "$BACKDROP" -eq 0 ] || FAILED=1

echo
echo "=== resize ==="
# ENGINE_LOG is assigned outright where SOCKET and PROFILE are defaulted. Those
# two are harmless to inherit; this one, inherited, sends every run to one file
# and lets the resize truncate the CSS run's log — which is exactly the defect
# the variable was added to fix, reintroduced for anyone who sets it.
PRODUCER=domicile_css_parity \
PAGE="$SCRIPTS/spike-resize-page.html" \
PAGE_QUERY="?color=$COLOR&app=domicile-spike" \
WINDOW_SIZE="$WINDOW" \
SOCKET="${SOCKET:-/tmp/domicile-spike-resize}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-resize-profile}" \
ENGINE_LOG=/tmp/domicile-spike-resize-engine.log \
  "$SCRIPTS/spike.sh" "$CHROMIUM" -- \
    "--check=resize" "--color=FF$COLOR" \
    "--resize-from=$RESIZE_FROM" "--resize-to=$RESIZE_TO" 2>&1 | tee "$RESIZE_LOG"
RESIZE=${PIPESTATUS[0]}
[ "$RESIZE" -eq 0 ] || FAILED=1

echo
if [ $FAILED -eq 0 ]; then
  echo "step 4: every property behaves as it does on an ordinary element, under a backdrop-filter as well as under none"
else
  # One line, whatever failed, because the thing reading it is a workflow step
  # that should not be re-deriving any of this. Every run runs whatever the
  # one before it does, so all of them can be named.
  VERDICT="step 4 failed:"
  [ "$CSS" -eq 0 ] ||
    VERDICT="$VERDICT the CSS run, $(run_verdict "$CSS_LOG")."
  [ "$BACKDROP" -eq 0 ] ||
    VERDICT="$VERDICT the backdrop-filter run, $(run_verdict "$BACKDROP_LOG")."
  [ "$RESIZE" -eq 0 ] ||
    VERDICT="$VERDICT the resize run, $(run_verdict "$RESIZE_LOG")."
  echo "$VERDICT" >&2
fi
exit $FAILED
