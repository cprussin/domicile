#!/usr/bin/env bash
# A display capture through the C ABI reads back what the shell drew, before
# and after a resize.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-display-capture.sh /build/chromium/src
#
# Headless and software-composited, so frames come in shared memory. The shell
# paints the whole page one color (guard-flat-color.js); domicile_capture_probe
# captures the browser's window and checks each frame's center.
#
# NEGATIVE=1 runs the control: the shell paints another color, and the frames
# must show that one. So the claim's color is the page read back, and not a
# constant.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-display-capture: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
COLOR="${COLOR:-3B7A57}"
OTHER="${OTHER:-8E4585}"
FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
WORK="$(mktemp -d /tmp/domicile-display-capture.XXXXXX)"
BROKER="$WORK/broker"
ENGINE_LOG="$WORK/engine.log"
PROBE_LOG="$WORK/probe.log"

ENGINE=""
cleanup() {
  [ -n "$ENGINE" ] && kill "$ENGINE" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

for binary in chrome domicile_capture_probe; do
  [ -x "$CHROMIUM/$OUT/$binary" ] || {
    annotate "guard-display-capture: no $binary in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
    exit 1
  }
done

if [ "$NEGATIVE" = "1" ]; then
  PAINTED="$OTHER"
else
  PAINTED="$COLOR"
fi

rm -f "$ENGINE_LOG" "$PROBE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?color=$PAINTED" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-flat-color.js" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$WORK/profile" \
  --window-size=800,600 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!

for _ in $(seq 1 240); do
  [ -S "$BROKER" ] && break
  sleep 0.5
done
[ -S "$BROKER" ] || {
  annotate_from "guard-display-capture: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}

# Only a component build gives executables an `$ORIGIN` rpath, so the out
# directory goes on LD_LIBRARY_PATH for libdomicile_engine.so.
(cd "$CHROMIUM/$OUT" && \
  LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  ./domicile_capture_probe \
  --domicile-broker-socket="$BROKER" \
  --color="$PAINTED" --for-seconds="$FOR_SECONDS") >"$PROBE_LOG" 2>&1
MEASURED="$NEGATIVE $?"
cat "$PROBE_LOG"

case "$MEASURED" in
"0 0")
  echo "PASS: a display capture shows the shell's color, $COLOR, at both sizes"
  exit 0
  ;;
"1 0")
  echo "PASS: the control is sharp: a shell painted $OTHER is captured as $OTHER"
  exit 0
  ;;
*" 1")
  FAILURE="frames came, and their center is not $PAINTED, the color the shell painted"
  ;;
*" 2")
  FAILURE="no frame came at the size asked: the browser refused the capture, or viz sent nothing"
  ;;
*)
  FAILURE="domicile_capture_probe did not run to a verdict ($MEASURED)"
  ;;
esac

annotate_from "guard-display-capture: $FAILURE" "$ENGINE_LOG"
tail -30 "$ENGINE_LOG" >&2
exit 1
