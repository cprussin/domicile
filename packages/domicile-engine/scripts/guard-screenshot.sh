#!/usr/bin/env bash
# `screenshot` on the command socket writes a PNG of what the shell drew.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-screenshot.sh /build/chromium/src
#
# Headless and software-composited. The shell paints the whole page one color;
# guard-screenshot.py asks for a screenshot until its center pixel is that
# color.
#
# NEGATIVE=1 runs the control: the shell paints another color, and the
# screenshot must show that one and not the claim's. So the claim's color is
# the page read back, and not a constant.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-screenshot: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
COLOR="${COLOR:-3B7A57}"
OTHER="${OTHER:-8E4585}"
FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
WORK="$(mktemp -d /tmp/domicile-screenshot.XXXXXX)"
BROKER="$WORK/broker"
COMMANDS="$WORK/command.sock"
SHOT="$WORK/shot.png"
ENGINE_LOG="$WORK/engine.log"

ENGINE=""
cleanup() {
  [ -n "$ENGINE" ] && kill "$ENGINE" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-screenshot: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-screenshot: no python3, which asks for the screenshot and reads it"
  exit 77
}

if [ "$NEGATIVE" = "1" ]; then
  PAINTED="$OTHER"
else
  PAINTED="$COLOR"
fi

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?color=$PAINTED" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-screenshot.js" \
  --domicile-command-socket="$COMMANDS" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$WORK/profile" \
  --window-size=800,600 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!

for _ in $(seq 1 240); do
  [ -S "$COMMANDS" ] && break
  sleep 0.5
done
[ -S "$COMMANDS" ] || {
  annotate_from "guard-screenshot: the engine never opened its command socket at $COMMANDS" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}

python3 "$SCRIPTS/guard-screenshot.py" \
  --socket "$COMMANDS" --file "$SHOT" \
  --want "$PAINTED" --for-seconds "$FOR_SECONDS"
MEASURED="$NEGATIVE $?"

case "$MEASURED" in
"0 0")
  echo "PASS: the screenshot shows the shell's color, $COLOR"
  exit 0
  ;;
"1 0")
  echo "PASS: the control is sharp: a shell painted $OTHER is read back as $OTHER"
  exit 0
  ;;
*" 1")
  FAILURE="a screenshot was written and its center is not $PAINTED, the color \
the shell painted"
  ;;
*" 2")
  FAILURE="no screenshot was written: the engine refused, or never answered"
  ;;
*)
  FAILURE="guard-screenshot.py did not run to a verdict ($MEASURED)"
  ;;
esac

annotate_from "guard-screenshot: $FAILURE" "$ENGINE_LOG"
tail -30 "$ENGINE_LOG" >&2
exit 1
