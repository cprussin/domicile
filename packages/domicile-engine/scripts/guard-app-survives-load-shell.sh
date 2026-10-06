#!/usr/bin/env bash
# A Wayland client's window keeps reaching the page across `domicile
# load-shell`, when the new shell draws its `<app>` at another size.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-app-survives-load-shell.sh /build/chromium/src
#
# Why: a reloaded shell is a new document in the same renderer, and its
# `<app>` adopts the app's surface. If it keeps the old LocalSurfaceId at the
# new box size, the producer's next frame is the wrong size for that surface,
# viz rejects it and closes the producer's frame sink, and the app freezes.
# See ExternalSurfaceEmbedder::Embed.
#
# The shell (guard-app-survives-load-shell.js) draws the first window at 40% of
# the page on load 1 and at 80% on load 2. kitty draws #COLOR. The guard sends
# `load_shell` to the engine's command socket, waits for the new shell to
# embed the client, then tells kitty to switch to #NEW_COLOR (OSC 11). The
# compositor searches the page for both colors. Then it asserts:
#
#   the engine answered `loaded`   the command reached the engine
#   the shell loaded twice         the reload happened
#   #COLOR before the reload       the client was on the first shell's page
#   the new shell embedded it      `domicile: embedded` after the second load
#   the probe kept looking         it searched for #NEW_COLOR and did not give
#                                  up
#   #NEW_COLOR after the reload    the claim: a frame drawn after the reload
#                                  reached the page
#   at the new box size            its box is at least 1.5 times the first
#                                  shell's box on each side
#
# Control: NEGATIVE=1 never tells kitty to switch. #NEW_COLOR must not turn up,
# so the claim's find is the client's frame and not something else on the
# page.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-app-survives-load-shell: no path to chromium/src was given"
  exit 1
fi

ROOT="$(cd "$SCRIPTS/../../.." && pwd)"

# Not any other guard's colors, so a stale log cannot match.
COLOR="${COLOR:-2E8B57}"
NEW_COLOR="${NEW_COLOR:-D2691E}"

# NEGATIVE=1 keeps kitty on #COLOR. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="switch"
[ "$NEGATIVE" = "1" ] && MODE="still"

# Must outlast the whole run: the probe runs on the submit path.
CLIENT_LIVES_FOR="${CLIENT_LIVES_FOR:-600}"
FOR_SECONDS="${FOR_SECONDS:-120}"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
# Not any other guard's paths.
BROKER="${BROKER:-/tmp/domicile-app-survives-load-shell-broker}"
COMMAND="${COMMAND:-/tmp/domicile-app-survives-load-shell-command}"
PROFILE="${PROFILE:-/tmp/domicile-app-survives-load-shell-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-app-survives-load-shell$WHICH-engine.log}"
COMP_LOG="${COMP_LOG:-/tmp/domicile-app-survives-load-shell$WHICH-compositor.log}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp}"
COMPOSITOR="$ROOT/target/debug/domicile-compositor"
STAGE="$(mktemp -d)"
CLI_LOG="$STAGE/client.log"
# kitty switches color once this exists.
SWITCH="$STAGE/switch"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE" "$STAGE"
  rm -f "$COMMAND"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-app-survives-load-shell: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  annotate "guard-app-survives-load-shell: no libdomicile_engine.so in $CHROMIUM/$OUT; build it with autoninja -C $OUT domicile_engine"
  exit 1
}
[ -x "$COMPOSITOR" ] || {
  annotate "guard-app-survives-load-shell: no compositor at $COMPOSITOR; build it with cargo build -p domicile-compositor"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-app-survives-load-shell: no python3, and the command is sent by one"
  exit 77
}
if command -v kitty >/dev/null; then
  KITTY=(kitty)
elif command -v nix >/dev/null; then
  KITTY=(nix shell nixpkgs#kitty --command kitty)
else
  skip "guard-app-survives-load-shell: no kitty to draw with, and no nix to fetch one"
  exit 77
fi

# The module's name sets its box; see guard-app-survives-load-shell.js.
cp "$SCRIPTS/guard-app-survives-load-shell.js" "$STAGE/load-1.js"
cp "$SCRIPTS/guard-app-survives-load-shell.js" "$STAGE/load-2.js"

export XDG_RUNTIME_DIR="$RUNTIME"
COMP_SOCK="$RUNTIME/domicile-app-survives-load-shell.sock"
rm -f "$BROKER" "$COMMAND" "$COMP_SOCK" "$COMP_SOCK.session" "$ENGINE_LOG" "$COMP_LOG" "$CLI_LOG"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -aqF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The engine on load 1, with the command socket `domicile load-shell` uses.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app=domicile://shell/ \
  --domicile-shell-root="$STAGE" \
  --domicile-shell-module=load-1.js \
  --domicile-control-socket="$COMP_SOCK" \
  --domicile-command-socket="$COMMAND" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size=1024,768 \
  --enable-blink-features=DomicileExternalSurface \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 240); do [ -S "$BROKER" ] && break; sleep 0.5; done
[ -S "$BROKER" ] || {
  annotate_from "guard-app-survives-load-shell: the engine never opened its broker socket at $BROKER" "$ENGINE_LOG"
  last_words "$ENGINE_LOG" >&2
  exit 1
}

# 2. The compositor, searching the page for both colors.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
DOMICILE_SPIKE_FIND="$COLOR;$NEW_COLOR" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" >"$COMP_LOG" 2>&1 &
COMP=$!
STARTED+=("$COMP")

# The host announces windows only after the shell agrees the protocol, so a
# client started earlier is announced to nobody.
wait_for_line 360 "chrome agreed the protocol" "$COMP_LOG" || {
  annotate_from "guard-app-survives-load-shell: the shell never joined the compositor" "$COMP_LOG"
  tail -20 "$COMP_LOG" >&2
  exit 1
}
CLIENT_DISPLAY=$(grep -aoE "wayland-[0-9]+" "$COMP_LOG" | head -1)
[ -n "$CLIENT_DISPLAY" ] || {
  annotate_from "guard-app-survives-load-shell: the compositor never named its Wayland display" "$COMP_LOG"
  exit 1
}

# 3. kitty, printing so it keeps committing frames, and switching its
#    background to NEW_COLOR once SWITCH exists.
echo "driving kitty, drawing #$COLOR"
NO_COLOR=1 WAYLAND_DISPLAY="$CLIENT_DISPLAY" timeout "$CLIENT_LIVES_FOR" \
  "${KITTY[@]}" --config NONE -o confirm_os_window_close=0 \
        -o "background=#$COLOR" \
        -o initial_window_width=640 -o initial_window_height=480 \
        sh -c 'while :; do
                 [ -e "$1" ] && printf "\033]11;#%s\033\\" "$2"
                 printf .; sleep 0.2
               done' sh "$SWITCH" "$NEW_COLOR" >"$CLI_LOG" 2>&1 &
STARTED+=($!)

# The box the compositor last logged for color $1, as `W H`.
size_of() {
  grep -aoE "engine found #FF$1 over \([0-9]+,[0-9]+\) [0-9]+x[0-9]+" "$COMP_LOG" \
    2>/dev/null | tail -1 | grep -oE "[0-9]+x[0-9]+$" | tr x ' '
}

# 4. Wait for the client on the first shell's page, and for its box to hold
#    still: kitty's first frame may not be at the box's size.
TRIES=$((FOR_SECONDS * 4))
BEFORE=""
for _ in $(seq 1 "$FOR_SECONDS"); do
  NOW="$(size_of "$COLOR")"
  [ -n "$NOW" ] && [ "$NOW" = "$BEFORE" ] && break
  BEFORE="$NOW"
  sleep 3
done
echo "before the reload, #$COLOR is ${BEFORE:-nowhere} (W H)"

# 5. The reload: load-2.js over load-1.js, as `domicile load-shell` sends it.
ANSWER="$(python3 - "$COMMAND" "$STAGE" <<'EOF' 2>&1
import json, socket, sys

path, root = sys.argv[1], sys.argv[2]
line = json.dumps({"type": "load_shell", "version": 1, "root": root,
                   "module": "load-2.js"})
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
    connection.sendall((line + "\n").encode())
    print(connection.makefile().readline().strip())
except OSError as failure:
    print("no answer: %s" % failure)
EOF
)"
echo "the engine answered: $ANSWER"

# Lines matching $1 after the second `shell-loaded`.
after_the_reload() {
  awk -v want="$1" '
    /GUARD shell-loaded/ { loads++ }
    loads >= 2 && index($0, want) { n++ }
    END { print n + 0 }' "$ENGINE_LOG"
}

# 6. Wait for the new shell to embed the client, then switch its color.
wait_for_line "$TRIES" "GUARD shell-loaded load=2" "$ENGINE_LOG" ||
  echo "the second shell never loaded; the verdict below says what that means" >&2
for _ in $(seq 1 "$TRIES"); do
  [ "$(after_the_reload "domicile: embedded")" -ge 1 ] && break
  sleep 0.25
done
sleep 2
if [ "$NEGATIVE" = "1" ]; then
  echo "control: kitty stays #$COLOR"
else
  echo "telling kitty to draw #$NEW_COLOR"
  : >"$SWITCH"
fi

# Whether #NEW_COLOR is on the page at least 1.5 times the first box on each
# side.
grown() {
  local before_w before_h new_w new_h
  read -r before_w before_h <<<"$BEFORE"
  read -r new_w new_h <<<"$(size_of "$NEW_COLOR")"
  [ -n "${before_w:-}" ] && [ -n "${new_w:-}" ] &&
    [ $((new_w * 2)) -ge $((before_w * 3)) ] &&
    [ $((new_h * 2)) -ge $((before_h * 3)) ]
}

# 7. Watch for the new color at the new size. The control expects an absence,
#    so it waits a multiple of the guard's time. See lib-control-budget.sh.
LOOKS="${LOOKS:-90}"
[ "$NEGATIVE" = "1" ] && LOOKS="$(budget_for app-survives-load-shell "$LOOKS")"
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  grown && break
  kill -0 "$COMP" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done

# The readings.
ANSWERED=0
[ "$ANSWER" = '{"type":"loaded"}' ] && ANSWERED=1
LOADS="$(grep -ac -F "GUARD shell-loaded" "$ENGINE_LOG" 2>/dev/null || true)"
BEFORE_SEEN=0
[ -n "$BEFORE" ] && BEFORE_SEEN=1
READOPTED=0
[ "$(after_the_reload "domicile: embedded")" -ge 1 ] && READOPTED=1
LOOKED=0
grep -aq "has not drawn #FF$NEW_COLOR" "$COMP_LOG" 2>/dev/null &&
  ! grep -aq "giving up looking" "$COMP_LOG" 2>/dev/null && LOOKED=1
FRESH=0
[ -n "$(size_of "$NEW_COLOR")" ] && FRESH=1
GROWN=0
grown && GROWN=1

if [ "$NEGATIVE" != "1" ] && [ "$GROWN" = "1" ]; then
  budget_note app-survives-load-shell "$WAITED"
fi

MEASURED="$MODE $ANSWERED $LOADS $BEFORE_SEEN $READOPTED $LOOKED $FRESH $GROWN"
echo
echo "#$COLOR before the reload: ${BEFORE:-nowhere} (W H)"
echo "#$NEW_COLOR after it: $(size_of "$NEW_COLOR") (W H)"
echo "measured: $MEASURED"
echo "  (mode answered loads before readopted looked fresh grown)"

# Which end to blame. `scripts/test-app-survives-load-shell-guard.sh` runs
# this block directly. MEASURED is "<mode> <answered> <loads> <before>
# <readopted> <looked> <fresh> <grown>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"switch 1 2 1 1 1 1 1")
  PASSED="a client's frame drawn after domicile load-shell reached the new \
shell's page, at the new shell's box size"
  ;;
"still 1 2 1 1 1 0 0")
  PASSED="the control is sharp: with kitty kept on its first color, the new \
color never turned up, so the claim's find is the client's frame"
  ;;
"switch 0 "* | "still 0 "*)
  FAILURE="the engine never answered the load_shell with loaded: the \
command socket was not bound (--domicile-command-socket), or the engine \
refused -- the answer is printed above"
  ;;
"switch 1 0 "* | "still 1 0 "*)
  FAILURE="the shell page never ran: the module did not load, or it threw, \
and the engine log has its console"
  ;;
"switch 1 1 "* | "still 1 1 "*)
  FAILURE="the engine said loaded and the shell was not loaded again"
  ;;
"switch 1 2 0 "* | "still 1 2 0 "*)
  FAILURE="the client never reached the first shell's page, so there was \
nothing to survive the reload: no window was announced, or the first <app> \
never embedded it"
  ;;
"switch 1 2 1 0 "* | "still 1 2 1 0 "*)
  FAILURE="the second shell never embedded the client: its <app> asked for \
no surface, or the broker never answered (no 'domicile: embedded' after the \
second shell-loaded)"
  ;;
"switch 1 2 1 1 0 "* | "still 1 2 1 1 0 "*)
  FAILURE="the compositor never searched for the new color or gave up, so \
'not found' means 'not looked for'. Its budget is FIND_FOR in \
domicile-compositor's main.rs"
  ;;
"switch 1 2 1 1 1 0 "*)
  FAILURE="THE APP FROZE: no frame the client drew after the reload reached \
the page. The new <app> adopted the old LocalSurfaceId at its new box size, \
viz rejected the producer's frame at that size and closed its frame sink. \
An adopt at a new size or scale needs a new id (ExternalSurfaceEmbedder::Embed)"
  ;;
"switch 1 2 1 1 1 1 0")
  FAILURE="the client's new frame reached the page at the old box's size, \
not the new shell's: the producer is still rendering at the first embed's size"
  ;;
"still 1 2 1 1 1 1 "*)
  FAILURE="the new color turned up when kitty was never told to draw it: \
the guard is matching something other than the client's frame"
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

annotate_from "guard-app-survives-load-shell: $FAILURE" "$COMP_LOG"
# A crash's bottom forty lines are the message loop, so print what it died of
# first.
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
echo "the compositor's last words:" >&2
grep -aE "engine|frame sink|buffer|dmabuf|ERROR|WARN" "$COMP_LOG" | tail -30 | sed 's/^/  /' >&2
echo "the probe, in order:" >&2
grep -aoE "engine (found|has not drawn|could not read the window at all looking for|settled).*" \
  "$COMP_LOG" 2>/dev/null | sed 's/^/  /' >&2
exit 1
