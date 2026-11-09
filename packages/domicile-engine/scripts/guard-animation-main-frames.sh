#!/usr/bin/env bash
# A composited animation runs on the compositor thread alone: the shell's main
# thread does not run a frame for each of its frames.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-animation-main-frames.sh /build/chromium/src
#
# Headless and software-composited. It reads the shell's console from the
# engine's log, so it needs no pixels and no client.
#
# Why: Chromium's field trial testing config turns on
# `CompositedAnimationsForceMainFrames` with `intersection-observer`, which
# runs a main frame and a commit for every frame of a transform animation in a
# document with an IntersectionObserver. A `<webview>` counts as one
# (`RemoteFrameView::HasActiveIntersectionObservations`), so every workspace
# switch redoes the desk's paint and commit each frame. Upstream leaves the
# parameter off for its power cost. Patch 0196 drops that study from the
# testing config.
#
# The shell slides a box across the viewport for a second and counts the
# IntersectionObserver callbacks while it plays; each needs a main frame.
# Asserted:
#
#   the shell page ran    or nothing was set up
#   the slide ended       its callback count was logged
#   few callbacks         at most MAX_CALLBACKS while it played, not one a
#                         frame
#
# Control: NEGATIVE=1 turns the forcing on with --enable-features, and must
# see more than MAX_CALLBACKS, so the claim's count is the build's doing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-animation-main-frames: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 forces main frames. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="claim"
FORCE=""
if [ "$NEGATIVE" = "1" ]; then
  MODE="control"
  FORCE="--enable-features=CompositedAnimationsForceMainFrames:intersection-observer/true"
fi

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-animation-main-frames$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-animation-main-frames$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-animation-main-frames$WHICH-engine.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# A slide of 60 frames delivers one callback a frame when main frames are
# forced, and one at each end when they are not.
MAX_CALLBACKS="${MAX_CALLBACKS:-10}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-animation-main-frames: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

rm -f "$ENGINE_LOG"
# shellcheck disable=SC2086 # FORCE is one switch or none.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size=1024,768 \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-animation-main-frames.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  $FORCE \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qF "GUARD slid callbacks=" "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# The callbacks the shell counted while the slide played, or `none`.
CALLBACKS="$(sed -n 's/.*GUARD slid callbacks=\([0-9]*\).*/\1/p' "$ENGINE_LOG" 2>/dev/null | tail -n 1)"
[ -n "$CALLBACKS" ] || CALLBACKS="none"

MEASURED="$MODE $(saw "GUARD shell-loaded") $CALLBACKS"
echo
echo "measured: $MEASURED (max $MAX_CALLBACKS)"
echo "  (mode shell callbacks-while-sliding)"

# Which end to blame. `packages/domicile-engine/tests/test-animation-main-frames-guard.sh`
# runs this block directly. MEASURED is "<mode> <shell> <callbacks>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"claim 0 "* | "control 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
*" 1 none")
  FAILURE="the slide never ended: the animation's finished promise never \
settled, so the shell logged no count"
  ;;
"claim 1 "*)
  if [ "${MEASURED##* }" -le "$MAX_CALLBACKS" ]; then
    PASSED="a composited slide ran without a main frame for each of its \
frames (${MEASURED##* } observer callbacks)"
  else
    FAILURE="THE SHELL RAN A MAIN FRAME FOR EVERY FRAME OF A COMPOSITED SLIDE \
(${MEASURED##* } observer callbacks): CompositedAnimationsForceMainFrames is \
forcing them. The field trial testing config turns it on; \
patch 0196 drops the CompositedAnimationsForceMainFrames study from it"
  fi
  ;;
"control 1 "*)
  if [ "${MEASURED##* }" -gt "$MAX_CALLBACKS" ]; then
    PASSED="the control is sharp: with main frames forced the same slide \
delivered ${MEASURED##* } callbacks, so the claim's few are the build's doing"
  else
    FAILURE="the control forced main frames and still saw only \
${MEASURED##* } callbacks, so a low count in the claim says nothing"
  fi
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-animation-main-frames: $FAILURE" "$ENGINE_LOG"
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
