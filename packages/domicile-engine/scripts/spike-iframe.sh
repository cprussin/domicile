#!/usr/bin/env bash
# The iframe-parity cell of step 4's measurement: is an <app> the same thing as
# an out-of-process <iframe>?
#
#   NIX_SHELL_RUN=".../scripts/spike-iframe.sh /build/chromium/src" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# ENGINE-FORK.md's CSS claim rests on one argument that was read off
# child_frame_compositing_helper.cc rather than measured: that an <app> under
# `transform` differs from a <div> only the way any surface-backed element
# does, an OOPIF included. This measures it.
#
# Two things this needs that no other check does:
#
#   an HTTP server   the <iframe> has to be CROSS-SITE or --site-per-process
#                    keeps it in the parent's renderer, where it paints into
#                    the parent's own layer tree like a <div> and the
#                    comparison is a tautology. localhost and 127.0.0.1 are
#                    different sites; two ports of one host are not, so a
#                    second port would not have done
#   a renderer count the pixels cannot tell "not out of process" from "out of
#                    process but re-rasterised". Counting renderers can, so the
#                    run fails if the iframe did not get one of its own
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

# On by default here, unlike every other check. This one asks whether an <app>
# is pixel-identical to an ordinary element, and software rasterisation is not
# pixel-identical to itself across two layers: run it with GPU=0 and the first
# row differs on a one-pixel outline that the same run on hardware does not
# have. The requirement is about what a user sees, so the GPU is the honest
# configuration and the software result is the artifact.
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

# Counted while the engine is up, and sampled rather than snapshotted: the
# pixels below cannot tell "the iframe is not out of process" from "it is, and
# it re-rasterised", and only one of those makes the comparison meaningful. A
# cross-site <iframe> gets a renderer of its own, so the floor is the main
# frame plus one for 127.0.0.1 — two. Chromium reuses one process per site, so
# framing it twice does not make it three.
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
