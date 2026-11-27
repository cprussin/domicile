#!/usr/bin/env bash
# A browser window whose page is paused on a dialog animates as smoothly as
# one whose page runs.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-paused.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the engine's log, so it needs no pixels and no client.
#
# Why: a page paused on `alert()`, `confirm()` or `prompt()` draws nothing
# until answered. A <webview> embeds its page with the default deadline
# whenever its visual properties change, so the shell's frame waits for the
# page. A window sliding across a screen's edge changed the part on screen
# (`compositor_viewport`) every frame, and one growing or shrinking changed the
# raster scale, so each of the shell's frames waited out the deadline: a
# workspace switch ran at a third of its frame rate (patch 0155).
#
# The shell (guard-webview-paused.js) plays a slide and a shrink on the window
# while its page runs, then makes the page open a `confirm()`, never answers,
# and plays both again. The shell's renderer logs each new surface its
# <webview> embeds, and whether it waits for the page to draw it (patch 0295,
# `--vmodule=remote_frame=1`). Each wait is what held the shell, so the guard
# counts those, not frames: a frame count moves with the machine's load.
# Asserted:
#
#   the shell page ran            or nothing was set up
#   the page loaded               a window was opened and navigated
#   every animation played        all four are in the log
#   the page paused               its confirm() reached the shell and never
#                                 returned
#   the log shows waits           an embed before the dialog waited: the first
#                                 one, and the 1px narrowing that opens the
#                                 dialog, change what the page draws
#   nothing paused waited         no embed while the page was paused waited
#                                 for it
#
# A transform holds the frame's rect and scale while it animates (patches
# 0233, 0281), so a slide or shrink often embeds no new surface at all; that
# passes too, as nothing waits. The embeds at once are printed, not required.
#
# The log's order is safe for these counts. The shell's renderer writes an
# embed's line itself, before anything it then says reaches the log through
# the browser: the narrowing's wait comes before "dialog-claimed", which the
# narrowing caused, and every paused embed before "played paused-shrink".
#
# The frame counts are printed, for a person reading a slow run.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-paused: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-paused-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-paused-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-paused-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-paused-http.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"
# The shell's window. The slide crosses its left edge.
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"
# Each animation's length.
ANIMATION_MS="${ANIMATION_MS:-2000}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-paused: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-paused: no python3, which serves the page"
  exit 77
}

fresh_broker
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page, on its own server like every <webview> guard's: `crux` reaches
#    no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-paused-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-paused: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-paused: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT"

# 2. The engine. `src` goes last: it is a URL.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size="$WIDTH,$HEIGHT" \
  --app="domicile://shell/?ms=$ANIMATION_MS&src=$SUBJECT/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-paused.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 --vmodule=remote_frame=1 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# 3. Wait for every animation.
TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD done" "$ENGINE_LOG" ||
  echo "the shell never finished; the verdict below says what that means" >&2

saw() { # $1 pattern
  grep -qF -- "$1" "$ENGINE_LOG" && echo 1 || echo 0
}

# Each animation's frame count, 0 for one that never played, in the order
# running-slide running-shrink paused-slide paused-shrink; then the embeds
# that waited before the dialog, and those that waited and that did not while
# the page was paused, from "dialog-claimed" to "played paused-shrink".
READ="$(awk '
  match($0, /GUARD played [a-z]+-[a-z]+ frames=[0-9]+/) {
    split(substr($0, RSTART + 13, RLENGTH - 13), parts, / frames=/)
    frames[parts[1]] = parts[2]
    if (parts[1] == "paused-shrink") ended = 1
  }
  /GUARD dialog-claimed/ { paused = 1 }
  /a <webview> embeds its page.s new surface and waits/ {
    if (!paused) before += 1
    else if (!ended) waited += 1
  }
  /a <webview> embeds its page.s new surface at once/ {
    if (paused && !ended) at_once += 1
  }
  END {
    printf "%d %d %d %d %d %d %d\n", frames["running-slide"], frames["running-shrink"],
      frames["paused-slide"], frames["paused-shrink"], before, waited, at_once
  }' "$ENGINE_LOG" 2>/dev/null)"

SAW_SHELL=$(saw "GUARD shell-loaded")
SAW_PAGE=$(saw "GUARD page-loaded")
# Paused: the shell claimed the dialog and the page never got past it.
SAW_PAUSED=$( (grep -qF "GUARD dialog-claimed" "$ENGINE_LOG" &&
  ! grep -qF "GUARD page-answered" "$ENGINE_LOG") && echo 1 || echo 0)

MEASURED="$SAW_SHELL $SAW_PAGE $SAW_PAUSED $READ"
echo
echo "measured: $MEASURED"
echo "  (shell page paused, then frames: running-slide running-shrink paused-slide paused-shrink,"
echo "   then embeds: waited before the dialog, waited while paused, at once while paused)"

# Which end to blame. `packages/domicile-engine/tests/test-webview-paused-guard.sh`
# runs this block directly. MEASURED is "<shell> <page> <paused> <running-slide>
# <running-shrink> <paused-slide> <paused-shrink> <waits-before> <paused-waits>
# <paused-at-once>".
FAILURE=""
PASSED=""
read -r M_SHELL M_PAGE M_PAUSED RUN_SLIDE RUN_SHRINK PAUSED_SLIDE PAUSED_SHRINK \
  WAITS_BEFORE PAUSED_WAITS PAUSED_AT_ONCE <<<"$MEASURED"
if [ "$M_SHELL" != "1" ]; then
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
elif [ "$M_PAGE" != "1" ]; then
  FAILURE="the page never loaded: openBrowserWindow opened no window or the \
list never reached the shell"
elif [ "$RUN_SLIDE" -eq 0 ] || [ "$RUN_SHRINK" -eq 0 ]; then
  FAILURE="the running page's animations never finished, so there is nothing \
to compare against: the <webview> never reported a page, or the shell threw"
elif [ "$M_PAUSED" != "1" ]; then
  FAILURE="the page never paused: its confirm() did not reach the shell as \
domicile-dialog after the resize, or it returned, so the paused counts would \
measure a running page"
elif [ "$PAUSED_SLIDE" -eq 0 ] || [ "$PAUSED_SHRINK" -eq 0 ]; then
  FAILURE="the paused page's animations never finished"
elif [ "$WAITS_BEFORE" -eq 0 ]; then
  FAILURE="no embed before the dialog waited for the page, though the first \
one and the 1px narrowing change what it draws. The log this guard counts is \
missing: --vmodule=remote_frame=1 did not reach the shell's renderer, or \
RemoteFrame::SynchronizeVisualProperties no longer logs (patch 0295), so no \
wait below would show"
elif [ "$PAUSED_WAITS" -ne 0 ]; then
  FAILURE="the shell waited for the paused page $PAUSED_WAITS times while its \
window slid and shrank, each for the whole deadline. A <webview> must raster \
its whole page (RemoteFrameView::ComputeCompositingRect), so a slide changes \
no compositor_viewport, and embed a change of scale alone (raster scale, \
size in the local root) at once (RemoteFrame::SynchronizeVisualProperties)"
else
  PASSED="a window whose page is paused on a dialog slid and shrank without \
the shell waiting for the page ($PAUSED_AT_ONCE embeds at once, none waited; \
$PAUSED_SLIDE/$RUN_SLIDE and $PAUSED_SHRINK/$RUN_SHRINK frames)"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-paused: $FAILURE" "$ENGINE_LOG"
echo "the shell's and the page's steps, in order:" >&2
grep -F "GUARD" "$ENGINE_LOG" >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
