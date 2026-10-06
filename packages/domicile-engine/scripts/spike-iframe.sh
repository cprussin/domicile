#!/usr/bin/env bash
# Measures whether an <app> renders like an out-of-process <iframe> under CSS.
# Results:
# docs/architecture/ENGINE-FORK-MEASUREMENTS.md#app-compared-to-an-out-of-process-iframe.
#
#   NIX_SHELL_RUN=".../scripts/spike-iframe.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# ENGINE-FORK.md's CSS claim, read from child_frame_compositing_helper.cc, is
# that an <app> under `transform` differs from a <div> only as any
# surface-backed element does, an OOPIF included. This checks it.
#
# Extra requirements:
#
#   an HTTP server   the <iframe> must be cross-site, or --site-per-process
#                    keeps it in the parent's renderer and the comparison is
#                    meaningless. localhost and 127.0.0.1 are different sites;
#                    two ports on one host are not
#   a renderer count pixels cannot tell "in process" from "out of process but
#                    re-rasterized", so the run fails unless the iframe got its
#                    own renderer
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: spike-iframe.sh <path to chromium/src>" >&2
  exit 1
fi

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
COLOR="${COLOR:-00C853}"
WINDOW="${WINDOW:-1200,1000}"
PORT="${PORT:-8730}"

# GPU on by default, unlike other checks. Software rasterization differs
# across two layers (GPU=0 shows a one-pixel outline in the first row), and
# the check is about what users see on hardware.
export GPU="${GPU:-1}"

command -v python3 >/dev/null || {
  echo "python3 is needed to serve the page over HTTP" >&2
  exit 1
}

python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$SCRIPTS" \
  >/tmp/domicile-spike-iframe-http.log 2>&1 &
HTTP=$!
cleanup() { kill "$HTTP" 2>/dev/null; wait "$HTTP" 2>/dev/null; }
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://localhost:$PORT/spike-iframe-page.html" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
if ! curl -fsS "http://localhost:$PORT/spike-iframe-page.html" >/dev/null 2>&1; then
  echo "the page never came up on port $PORT; see /tmp/domicile-spike-iframe-http.log" >&2
  exit 1
fi

# Sample the peak renderer count while the engine runs. A cross-site <iframe>
# needs its own renderer, so the minimum is two: the main frame and 127.0.0.1.
# Chromium uses one process per site, so a second iframe adds none.
PEAK_FILE="$(mktemp)"
echo 0 >"$PEAK_FILE"
( PEAK=0
  for _ in $(seq 1 40); do
    NOW=$(pgrep -f -- "--type=renderer" 2>/dev/null | wc -l)
    [ "$NOW" -gt "$PEAK" ] && PEAK="$NOW"
    echo "$PEAK" >"$PEAK_FILE"
    sleep 0.5
  done
) &
COUNTER=$!
report_renderers() {
  kill "$COUNTER" 2>/dev/null
  PEAK=$(cat "$PEAK_FILE" 2>/dev/null || echo 0)
  echo
  echo "renderer processes at peak: $PEAK"
  if [ "$PEAK" -lt 2 ]; then
    echo "  the <iframe> did NOT get a renderer of its own, so it painted into" >&2
    echo "  the parent's own layer tree and the table above compared an <app>" >&2
    echo "  against something that is not a surface. The run means nothing." >&2
    return 1
  fi
  echo "  so the <iframe> is out of process and reaches the page as a"
  echo "  cc::SurfaceLayer, which is what makes the comparison a comparison"
  return 0
}

echo "compositing: $([ "$GPU" = 1 ] && echo "GPU" || echo "software")"

PRODUCER=domicile_css_parity \
URL="http://localhost:$PORT/spike-iframe-page.html?color=$COLOR&app=domicile-spike" \
WINDOW_SIZE="$WINDOW" \
SOCKET="${SOCKET:-/tmp/domicile-spike-iframe}" \
PROFILE="${PROFILE:-/tmp/domicile-spike-iframe-profile}" \
  "$SCRIPTS/spike.sh" "$CHROMIUM" \
    --site-per-process -- \
    "--check=iframe" "--color=FF$COLOR"
RESULT=$?

report_renderers || RESULT=1
rm -f "$PEAK_FILE"
exit $RESULT
