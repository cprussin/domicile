#!/usr/bin/env bash
# A shell keeps its page, its `<app>` and its watch across a compositor
# restart under the same engine.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-app-survives-compositor-restart.sh /build/chromium/src
#
# Why: the page's control channel used to die with its compositor, so a
# restarted compositor had no shell to show. Now the channel dials the next
# one. See "A compositor restart" in docs/architecture/ENGINE-FORK.md.
#
# The shell (guard-app-survives-compositor-restart.js) draws the first window
# in an `<app>` it keeps, and watches WATCHED. kitty draws #COLOR. The guard
# kills the compositor, starts another on the same sockets, and starts a kitty
# drawing #NEW_COLOR. The second compositor's first window has the first's app
# id, so the kept `<app>` embeds it again. Then it touches a file in WATCHED.
# It asserts:
#
#   the first client reached the page   #COLOR was found
#   the next compositor joined           the shell said hello to it
#   the window closed                    the shell heard `app_closed`
#   the watch ended compositor_gone      and the shell watched again
#   the shell heard compositorreplaced   the event fired
#   the new watch heard the touch        it reached the next compositor
#   the probe kept looking               it searched for #NEW_COLOR and did
#                                        not give up
#   #NEW_COLOR on the page               the claim: the kept `<app>` embedded
#                                        the next compositor's window
#
# Control: NEGATIVE=1 has the second kitty draw #COLOR. #NEW_COLOR must not
# turn up, so the claim's find is the client's frame and not something else on
# the page.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-app-survives-compositor-restart: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Not any other guard's colors, so a stale log cannot match.
COLOR="${COLOR:-4682B4}"
NEW_COLOR="${NEW_COLOR:-B8860B}"

# NEGATIVE=1 has the second kitty draw #COLOR. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="switch"
[ "$NEGATIVE" = "1" ] && MODE="still"
SECOND_COLOR="$NEW_COLOR"
[ "$NEGATIVE" = "1" ] && SECOND_COLOR="$COLOR"

CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-600}"
FOR_SECONDS="${FOR_SECONDS:-120}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
# Not any other guard's paths. WATCHED must match the shell's.
BROKER="${BROKER:-/tmp/domicile-app-survives-compositor-restart-broker}"
PROFILE="${PROFILE:-/tmp/domicile-app-survives-compositor-restart-profile}"
WATCHED="/tmp/domicile-app-survives-compositor-restart-watched"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-app-survives-compositor-restart$WHICH-engine.log}"
COMP_LOG="${COMP_LOG:-/tmp/domicile-app-survives-compositor-restart$WHICH-compositor.log}"
NEXT_LOG="${NEXT_LOG:-/tmp/domicile-app-survives-compositor-restart$WHICH-next-compositor.log}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"
STAGE="$(mktemp -d)"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -rf "$STAGE" "$WATCHED"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-app-survives-compositor-restart: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-app-survives-compositor-restart: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-app-survives-compositor-restart: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-app-survives-compositor-restart: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

cp "$SCRIPTS/guard-app-survives-compositor-restart.js" "$STAGE/restart.js"

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-app-survives-compositor-restart.sock"
fresh_broker
rm -f "$COMP_SOCK" "$COMP_SOCK.session" "$ENGINE_LOG" "$COMP_LOG" "$NEXT_LOG"
rm -rf "$PROFILE" "$WATCHED"
mkdir -p "$PROFILE" "$WATCHED"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -aqF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# The watch the shell holds now: the id it last sent the watch under. Each
# hang-up fails the watch and the shell sends it again under a new id, and a
# compositor killed outright can hang up twice: the engine dials straight
# back, reaches the dying one before its socket closes, and hears it go again.
# So the touch must reach the last id, whichever that is.
watching_id() { # $1 the engine log
  sed -n 's/.*GUARD rewatch id=\([0-9][0-9]*\).*/\1/p' "$1" 2>/dev/null | tail -1
}
watch_started() { # $1 the engine log
  local id
  id="$(watching_id "$1")"
  [ -n "$id" ] && grep -aqF "\"id\":$id,\"reply\":{\"kind\":\"started\"}" "$1"
}
heard_the_touch() { # $1 the engine log, $2 the touched path
  local id
  id="$(watching_id "$1")"
  [ -n "$id" ] && grep -aqF \
    "\"type\":\"system_event\",\"id\":$id,\"event\":{\"kind\":\"changed\",\"path\":\"$2\"}" \
    "$1"
}
# The end of the watch readings.

# A compositor on the shared sockets, logging to $1 and searching the page for
# $2.
compositor() {
  LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  DOMICILE_SPIKE_FIND="$2" \
    "$COMPOSITOR" \
      --chrome-socket "$COMP_SOCK" \
      --session "$COMP_SOCK.session" \
      --engine-socket "$BROKER" >"$1" 2>&1 &
  COMP=$!
  STARTED+=("$COMP")
}

# kitty on the Wayland display $1 names in its log, drawing #$2.
client() {
  local display
  display=$(grep -aoE "wayland-[0-9]+" "$1" | head -1)
  [ -n "$display" ] || return 1
  echo "driving kitty on $display, drawing #$2"
  NO_COLOR=1 WAYLAND_DISPLAY="$display" timeout "$CLIENT_LIVES_FOR" \
    "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
          -o "background=#$2" \
          -o initial_window_width=640 -o initial_window_height=480 \
          sh -c 'while :; do printf .; sleep 0.2; done' >/dev/null 2>&1 &
  STARTED+=($!)
}

# Whether the compositor logging to $2 found #$1 on the page.
found() {
  grep -aqE "engine found #FF$1 over" "$2" 2>/dev/null
}

# 1. The engine.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app=domicile://shell/ \
  --domicile-shell-root="$STAGE" \
  --domicile-shell-module=restart.js \
  --domicile-control-socket="$COMP_SOCK" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-app-survives-compositor-restart: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  last_words "$ENGINE_LOG" >&2
  exit 1
}

# 2. The first compositor and its client.
compositor "$COMP_LOG" "$COLOR"
wait_for_line 360 "chrome agreed the protocol" "$COMP_LOG" || {
  annotate_from "guard-app-survives-compositor-restart: the shell never joined the first compositor" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
}
client "$COMP_LOG" "$COLOR" || {
  annotate_from "guard-app-survives-compositor-restart: the compositor never named its Wayland display" "$COMP_LOG"
  exit 1
}
TRIES=$((FOR_SECONDS * 4))
for _ in $(seq 1 "$TRIES"); do
  found "$COLOR" "$COMP_LOG" && break
  sleep 0.25
done
wait_for_line "$TRIES" '"id":1,"reply":{"kind":"started"}' "$ENGINE_LOG" ||
  echo "the first watch never started; the verdict below says what that means" >&2

# 3. The crash, and the launcher's part of a restart: the dead compositor's
#    chrome socket and session go, the broker socket stays.
echo "killing the first compositor"
kill -9 "$COMP" 2>/dev/null
wait "$COMP" 2>/dev/null
rm -f "$COMP_SOCK" "$COMP_SOCK.session"
wait_for_line 40 "GUARD closed app=" "$ENGINE_LOG" ||
  echo "the shell never heard its window close" >&2

# 4. The next compositor, and a client that draws #SECOND_COLOR.
compositor "$NEXT_LOG" "$NEW_COLOR"
wait_for_line 360 "chrome agreed the protocol" "$NEXT_LOG" ||
  echo "the shell never joined the next compositor" >&2
wait_for_line 40 "GUARD replaced" "$ENGINE_LOG" ||
  echo "the shell never heard compositorreplaced" >&2
client "$NEXT_LOG" "$SECOND_COLOR" ||
  echo "the next compositor never named its Wayland display" >&2

# 5. A change the new watch must hear.
for _ in $(seq 1 "$TRIES"); do
  watch_started "$ENGINE_LOG" && break
  sleep 0.25
done
watch_started "$ENGINE_LOG" || echo "the watch sent again never started" >&2
touch "$WATCHED/touched"

# 6. Watch for the new color. The control expects an absence, so it waits a
#    multiple of the guard's time. See lib-control-budget.sh.
LOOKS="${LOOKS:-90}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for app-survives-compositor-restart "$LOOKS")"
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  found "$NEW_COLOR" "$NEXT_LOG" && break
  kill -0 "$COMP" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done

# The readings.
FIRST=0
found "$COLOR" "$COMP_LOG" && FIRST=1
JOINED=0
grep -aqF "chrome agreed the protocol" "$NEXT_LOG" 2>/dev/null && JOINED=1
CLOSED=0
grep -aqF "GUARD closed app=" "$ENGINE_LOG" 2>/dev/null && CLOSED=1
ENDED=0
grep -aqF '"id":1,"type":"system_end"' "$ENGINE_LOG" 2>/dev/null &&
  grep -aqF "compositor_gone" "$ENGINE_LOG" 2>/dev/null &&
  grep -aqF "GUARD rewatch id=2" "$ENGINE_LOG" 2>/dev/null && ENDED=1
REPLACED=0
grep -aqF "GUARD replaced" "$ENGINE_LOG" 2>/dev/null && REPLACED=1
HEARD=0
heard_the_touch "$ENGINE_LOG" "$WATCHED/touched" && HEARD=1
# The second client draws from its first frame, so a find with no miss before
# it is a look too.
LOOKED=0
{ grep -aq "has not drawn #FF$NEW_COLOR" "$NEXT_LOG" 2>/dev/null ||
  found "$NEW_COLOR" "$NEXT_LOG"; } &&
  ! grep -aq "giving up looking" "$NEXT_LOG" 2>/dev/null && LOOKED=1
FRESH=0
found "$NEW_COLOR" "$NEXT_LOG" && FRESH=1

if [ "$NEGATIVE" != "1" ] && [ "$FRESH" = "1" ]; then
  budget_note app-survives-compositor-restart "$WAITED"
fi

MEASURED="$MODE $FIRST $JOINED $CLOSED $ENDED $REPLACED $HEARD $LOOKED $FRESH"
echo
echo "measured: $MEASURED"
echo "  (mode first joined closed ended replaced heard looked fresh)"

# Which end to blame. `scripts/test-app-survives-compositor-restart-guard.sh`
# runs this block directly. MEASURED is "<mode> <first> <joined> <closed>
# <ended> <replaced> <heard> <looked> <fresh>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"switch 1 1 1 1 1 1 1 1")
  PASSED="the shell kept its page across a compositor restart: its window \
closed, its watch ended and was heard again, and its kept <app> showed the \
next compositor's window"
  ;;
"still 1 1 1 1 1 1 1 0")
  PASSED="the control is sharp: with the second client drawing the first \
color, the new color never turned up, so the claim's find is the client's frame"
  ;;
"switch 0 "* | "still 0 "*)
  FAILURE="the first client never reached the page, so there was nothing \
to survive the restart: no window was announced, or the <app> never embedded \
it"
  ;;
"switch 1 0 "* | "still 1 0 "*)
  FAILURE="the shell never said hello to the next compositor: its control \
channel did not dial again after the hang-up (ControlChannel::OnHungUp), or \
the next compositor could not join the engine's broker \
(DomicileBrowserService listens again on SetProducerGoneCallback)"
  ;;
"switch 1 1 0 "* | "still 1 1 0 "*)
  FAILURE="the shell never heard the old compositor's window close: the \
browser sent no app_closed for it (ControlChannel::OnHungUp)"
  ;;
"switch 1 1 1 0 "* | "still 1 1 1 0 "*)
  FAILURE="the shell's watch did not end with compositor_gone, so the page \
had no cue to watch again (ControlChannel::OnHungUp)"
  ;;
"switch 1 1 1 1 0 "* | "still 1 1 1 1 0 "*)
  FAILURE="the shell never heard compositorreplaced \
(ControlChannel::OnConnect, DomicileHost::CompositorReplaced)"
  ;;
"switch 1 1 1 1 1 0 "* | "still 1 1 1 1 1 0 "*)
  FAILURE="the watch sent again never heard the touch: the page's call did \
not reach the next compositor, or was dropped with the old one's queue"
  ;;
"switch 1 1 1 1 1 1 0 "* | "still 1 1 1 1 1 1 0 "*)
  FAILURE="the next compositor never searched for the new color or gave up, \
so 'not found' means 'not looked for'. Its budget is FIND_FOR in \
domicile-compositor's spike_probes.rs"
  ;;
"switch 1 1 1 1 1 1 1 0")
  FAILURE="THE KEPT <app> STAYED BLANK: the next compositor's window never \
reached the page. On kProducerGone the embedder should embed again with a new \
token, and the broker should hold it until the new compositor brokers the app \
(ENGINE-FORK.md, A compositor restart)"
  ;;
"still 1 1 1 1 1 1 1 1")
  FAILURE="the new color turned up when no client drew it: the guard is \
matching something other than the client's frame"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the run did not get as far as reading, or ran a mode this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-app-survives-compositor-restart: $FAILURE" "$NEXT_LOG"
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the shell, in order:" >&2
grep -aoE "GUARD .*" "$ENGINE_LOG" 2>/dev/null | head -40 | sed 's/^/  /' >&2
echo "the next compositor's last words:" >&2
grep -aE "engine|frame sink|chrome|ERROR|WARN" "$NEXT_LOG" | tail -30 | sed 's/^/  /' >&2
exit 1
