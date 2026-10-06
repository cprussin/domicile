#!/usr/bin/env bash
# The CSS parity measurement in docs/architecture/ENGINE-FORK-MEASUREMENTS.md#css-parity.
#
#   NIX_SHELL_RUN=".../scripts/guard-css-and-resize.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Run inside the toolchain shell: a component build links against its glibc.
#
# Three runs of spike.sh:
#
#   css              eight cells (a baseline, one per CSS property, and a
#                    negative control), each on an <app> and on an identical
#                    <div>, plus submit-to-output latency
#   backdrop-filter  the same cells under a filtering element, like translucent
#                    chrome over a window. An <app> under it must match a <div>
#   resize           the <app>'s box changes and the producer follows. Its own
#                    page, because every <app> in a document shares one surface
#                    and a new LocalSurfaceId strands the others
#
# Exits 0 only if all three pass. Do not work around a failing property; it is
# a real result.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: guard-css-and-resize.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"

# Passed to both the producer and the page, which have no channel between them.
COLOR="${COLOR:-00C853}"

# Must match spike-resize-page.html.
RESIZE_FROM="${RESIZE_FROM:-120x90}"
RESIZE_TO="${RESIZE_TO:-180x130}"

# A per-pixel filter, not a blur. Cells compare interior pixels only, because
# edges are resampled differently under software rasterization; a blur would
# spread those edge differences inward. `invert(1)` also makes the largest
# difference for the negative control.
#
# To measure a blur, set `BACKDROP_FILTER='blur(8px)'` with `GPU=1`, where edges
# match. The value must be one token, as it goes in a query string.
BACKDROP_FILTER="${BACKDROP_FILTER:-invert(1)}"

# The page logs this once the filter is applied. Without it, the cells would
# pass with no filter at all.
FILTER_APPLIED="domicile: backdrop-filter $BACKDROP_FILTER is over"

# Fits the cells in css_parity_layout.h plus browser chrome.
WINDOW="${WINDOW:-1200,1000}"

FAILED=0

# One log per run, since each verdict is about one run. `tee` shows output to
# a person running by hand. The pipe block-buffers stdout, so stderr lines may
# appear out of order.
CSS_LOG="${CSS_LOG:-/tmp/domicile-step4-css.log}"
BACKDROP_LOG="${BACKDROP_LOG:-/tmp/domicile-step4-backdrop.log}"
RESIZE_LOG="${RESIZE_LOG:-/tmp/domicile-step4-resize.log}"

# Says why one failed run failed, from that run's log only.
run_verdict() { # $1 that run's log
  # Check cells first: a run can fail both a cell and the latency probe, and the
  # cell is the real result. `FAIL($|[^E])` skips the summary's own "FAILED".
  if grep -qE 'FAIL($|[^E])' "$1"; then
    echo "a cell is marked FAIL"
  # `never appeared after N draws` means the probe worked and the color never
  # reached the output: a real failure. Any other `latency:` line is the probe.
  elif grep -q '^latency: .* never appeared after ' "$1"; then
    echo "every cell passed and then a color the producer submitted never reached the screen, which is the seam"
  elif grep -q '^latency: ' "$1"; then
    echo "every cell passed and the probe then stopped answering, which is the instrument rather than the seam"
  else
    # The producer has already printed its own reason.
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
# Named so the filter check below can read it back.
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
# The cells pass without a filter too, so require the page's confirmation. The
# message goes into this run's log for the verdict.
if ! grep -qF "$FILTER_APPLIED" "$BACKDROP_ENGINE_LOG"; then
  echo "the page never said it applied $BACKDROP_FILTER, so nothing above was filtered" |
    tee -a "$BACKDROP_LOG" >&2
  BACKDROP=1
fi
[ "$BACKDROP" -eq 0 ] || FAILED=1

echo
echo "=== resize ==="
# ENGINE_LOG is set outright, not defaulted like SOCKET and PROFILE: an
# inherited value would send every run to one file and truncate the others' logs.
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
  # `check.sh` shows only the `PASS:` lines of a passing check.
  echo "PASS: css — each property on an <app> matches the same property on an ordinary <div>, interior pixel for interior pixel"
  echo "PASS: backdrop-filter — so does each under $BACKDROP_FILTER, which the page said it applied"
  echo "PASS: resize — the <app> went from $RESIZE_FROM to $RESIZE_TO, the producer followed it, and it still matches a <div>"
else
  # One line naming every failed run, for the workflow step to report.
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
