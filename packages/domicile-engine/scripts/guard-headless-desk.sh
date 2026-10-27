#!/usr/bin/env bash
# A headless desk shows the compositor's virtual displays, and a capture of
# each shows its own part of the one shell page.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-headless-desk.sh /build/chromium/src
#
# The engine runs on ozone headless with `--domicile-headless-desk`, software
# composited, as `domicile` runs it with OZONE=headless. domicile_desk_probe
# stands in for the compositor: it adds a 640x480 display and a 320x240 one
# right of it, lays them out, and captures each. The shell paints its first
# 640 pixels one color and the rest another (guard-split-color.js), so each
# display must show its own color.
#
# NEGATIVE=1 runs the control: the shell's colors swap, and the probe must
# say a display shows the wrong one.
#
# See docs/architecture/A-HEADLESS-DESKTOP.md.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-headless-desk: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"
LEFT="${LEFT:-3B7A57}"
RIGHT="${RIGHT:-8E4585}"
FOR_SECONDS="${FOR_SECONDS:-90}"

OUT="${OUT:-out/Domicile}"
WORK="$(mktemp -d /tmp/domicile-headless-desk.XXXXXX)"
BROKER="$WORK/broker"
ENGINE_LOG="$WORK/engine.log"
PROBE_LOG="$WORK/probe.log"

ENGINE=""
cleanup() {
  # Wait for the engine, which writes its profile until it exits.
  [ -n "$ENGINE" ] && kill "$ENGINE" 2>/dev/null && wait "$ENGINE" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

for binary in chrome domicile_desk_probe; do
  [ -x "$CHROMIUM/$OUT/$binary" ] || {
    annotate "guard-headless-desk: no $binary in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
    exit 1
  }
done

if [ "$NEGATIVE" = "1" ]; then
  PAINTED="left=$RIGHT&right=$LEFT"
else
  PAINTED="left=$LEFT&right=$RIGHT"
fi

rm -f "$ENGINE_LOG" "$PROBE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --domicile-headless-desk \
  --ozone-override-screen-size=1024,768 \
  --start-fullscreen \
  --disable-gpu \
  --app="domicile://shell/?$PAINTED&split=640" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-split-color.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$WORK/profile" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!

for _ in $(seq 1 240); do
  [ -S "$BROKER" ] && break
  sleep 0.5
done
[ -S "$BROKER" ] || {
  annotate_from "guard-headless-desk: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  tail -20 "$ENGINE_LOG" >&2
  exit 1
}

# Only a component build gives executables an `$ORIGIN` rpath, so the out
# directory goes on LD_LIBRARY_PATH for libdomicile_engine.so.
(cd "$CHROMIUM/$OUT" && \
  LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  ./domicile_desk_probe \
  --domicile-broker-socket="$BROKER" \
  --left="$LEFT" --right="$RIGHT" --for-seconds="$FOR_SECONDS") >"$PROBE_LOG" 2>&1
MEASURED="$NEGATIVE $?"

case "$MEASURED" in
"0 0")
  cat "$PROBE_LOG"
  echo "PASS: each virtual display of a headless desk shows its own part of the shell"
  exit 0
  ;;
"1 1")
  cat "$PROBE_LOG"
  echo "PASS: the control is sharp: with the shell's colors swapped, a display shows the wrong one"
  exit 0
  ;;
"0 1")
  FAILURE="a display shows the other display's color, or neither: the desk is not laid out across them"
  ;;
"1 0")
  FAILURE="the control passed with the colors swapped, so the probe reads something other than the page"
  ;;
*" 2")
  FAILURE="the virtual displays never came on their connectors, or one gave no frame at its size"
  ;;
*)
  FAILURE="domicile_desk_probe did not run to a verdict ($MEASURED)"
  ;;
esac

annotate_from "guard-headless-desk: $FAILURE" "$ENGINE_LOG"
# The probe's log goes last, since a failed check's report keeps only its
# last lines.
tail -30 "$ENGINE_LOG" >&2
echo "--- domicile_desk_probe ---" >&2
cat "$PROBE_LOG" >&2
exit 1
