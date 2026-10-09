#!/usr/bin/env bash
# Presses a Meta chord into the nested session and checks which side took it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shortcuts-inhibitor-chord.sh /build/chromium/src
#
# With `--domicile-inhibit-host-shortcuts`, a chord the host binds reaches the
# page and does not fire the host binding. Without it, the binding fires and
# the page gets nothing. So sway honors the inhibitor patch `0038` requests.
#
# Not covered: hosts other than sway, physical keyboards, what a shell's SDK
# does with the key, or focus changes between clients. `domicile-launch`
# passes the switch in a real desktop; here it is passed by hand.
#
# Separate from `guard-shortcuts-inhibitor.sh`, which checks only that the
# engine sends the request. This checks that the host acts on it, needs sway's
# IPC, and cannot use that guard's `WAYLAND_DEBUG=1` log, which floods the
# engine log this reads.
#
# Two observers, one per side, so "not here" can be told apart from "nowhere":
#
#   the host   a sway binding on the chord that appends a line to `$HOST_LOG`.
#              sway does not forward a key that matched a binding
#   the page   `guard-shortcuts-inhibitor-chord.js`, which logs every keydown
#              to the console (the engine writes it to its log)
#
# Each observer is calibrated first, since both claims rest on an absence:
#
#   host binding fires with    the chord pressed before the engine starts must
#     nothing focused          write its line
#   a plain key reaches the    a key sway does not bind, pressed once the window
#     page                     is up, must arrive
#
# `$CHORD_KEY` with Mod4 is the chord; `$PLAIN_KEY` is a different key so the
# calibration cannot satisfy the chord check. Neither is bound by sway's
# default config, since this can run in a person's own session.
#
# Readings, each meaningful only if the ones above it hold:
#
#   the engine is still running
#   a virtual keyboard came up
#   the binding was installed
#   the binding fired, unfocused
#   the page is listening         `GUARD listening`
#   the plain key reached it      `GUARD focused` shows which half failed
#   the chord went somewhere
#   which side took it            the claim
#
# `NEGATIVE=1` omits `--domicile-inhibit-host-shortcuts`; the chord must then
# fire the binding and not reach the page. It passes the same gates first.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-compositor-cleanup.sh
. "$SCRIPTS/lib-compositor-cleanup.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shortcuts-inhibitor-chord: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 runs without the switch. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shortcuts-inhibitor-chord-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shortcuts-inhibitor-chord-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long to wait for the page to load and the window to get the keyboard.
# Generous for cold starts; each wait ends as soon as its line appears.
FOR_SECONDS="${FOR_SECONDS:-90}"

# Slack for a key to land on a busy machine.
KEY_SECONDS="${KEY_SECONDS:-15}"

# How long the side that did not take the chord gets to report it.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# Keep the keyboard alive for the whole run. See
# `guard-shortcuts-inhibitor.sh`.
KEYBOARD_LIVES_FOR_MS="${KEYBOARD_LIVES_FOR_MS:-300000}"

# See the header.
CHORD_KEY="y"
PLAIN_KEY="u"
CHORD="Mod4+$CHORD_KEY"

# A run and its control write separate logs.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shortcuts-inhibitor-chord$WHICH-engine.log}"
KEYBOARD_LOG="${KEYBOARD_LOG:-/tmp/domicile-shortcuts-inhibitor-chord$WHICH-keyboard.log}"
HOST_LOG="${HOST_LOG:-/tmp/domicile-shortcuts-inhibitor-chord$WHICH-host.log}"

# Kill everything this starts before returning. The keyboard (`wtype` behind
# `nix shell`) and the browser both fork, so the `&` pids are not the live ones;
# both carry `lib-compositor-cleanup.sh`'s marker instead.
#
# Also remove the binding: in a person's own session it would otherwise
# capture a Mod4 chord.
# `scripts/test-the-shortcuts-guards-leave-nothing-running.sh` checks both.
BOUND=0
cleanup() {
  if [ "$BOUND" = "1" ]; then
    "${SWAYMSG[@]}" -- unbindsym "$CHORD" >/dev/null
  fi
  kill_compositors "$(compositor_owner)"
  wait
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shortcuts-inhibitor-chord: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -n "${WAYLAND_DISPLAY:-}" ] || {
  annotate "guard-shortcuts-inhibitor-chord: no WAYLAND_DISPLAY; run this under packages/domicile-engine/scripts/under-wayland.sh"
  exit 1
}

# `wtype` and `swaymsg` come from nixpkgs, like sway in `under-wayland.sh`.
# `swaymsg` from the same package speaks that sway's IPC.
if command -v wtype >/dev/null; then
  WTYPE=(wtype)
elif command -v nix >/dev/null; then
  WTYPE=(nix shell nixpkgs#wtype --command wtype)
else
  WTYPE=()
fi
if command -v swaymsg >/dev/null; then
  SWAYMSG=(swaymsg)
elif command -v nix >/dev/null; then
  SWAYMSG=(nix shell nixpkgs#sway --command swaymsg)
else
  SWAYMSG=()
fi

rm -f "$BROKER"
rm -rf "$PROFILE"
mkdir -p "$PROFILE"
# Truncate so the line count is this run's firings.
: >"$HOST_LOG"

# Whether the page said `$1`, as `1` or `0`.
#
# Match the closing quote: Chromium logs `"GUARD keydown key=y meta=true",
# source: ...`, and without it `key=y` would match any key starting with `y`.
page_saw() { # $1 extended regular expression over one GUARD message
  grep -aqE "\"GUARD $1\"" "$ENGINE_LOG" 2>/dev/null && echo 1 || echo 0
}

# How many times the host's binding has fired.
host_fired() {
  grep -c . "$HOST_LOG"
}

# Waits up to `$1` seconds for `$2...` to succeed, a quarter second at a time.
wait_until() { # $1 seconds, then a command
  local seconds="$1"
  shift
  for _ in $(seq 1 $((seconds * 4))); do
    "$@" && return 0
    sleep 0.25
  done
  return 1
}

page_said() { # as page_saw, as a status
  [ "$(page_saw "$1")" = "1" ]
}

host_fired_past() { # $1 a count of firings
  [ "$(host_fired)" -gt "$1" ]
}

chord_landed() {
  host_fired_past "$HOST_BEFORE" ||
    page_said "keydown key=$CHORD_KEY meta=(true|false)"
}

# Whether the engine is running and not a zombie (field 3 of stat).
# `ENGINE_PID` is the browser itself because `env` execs it.
engine_running() {
  local stat
  stat="$( { cat "/proc/$ENGINE_PID/stat"; } 2>/dev/null )"
  [ -n "$stat" ] && [ "$(printf '%s\n' "${stat##*) }" | awk '{ print $1 }')" != Z ]
}

# Records how the engine ended and where the guard first noticed. `wait`
# returns an already-reaped child's status, so the signal is captured.
engine_check() { # $1 where the guard is
  local status
  if [ -z "$ENGINE_EXIT" ] && ! engine_running; then
    wait "$ENGINE_PID"
    status=$?
    ENGINE_FOUND_DEAD="$1"
    if [ "$status" -gt 128 ]; then
      ENGINE_EXIT="crashed, killed by signal $((status - 128)) ($(kill -l "$status"))"
    else
      ENGINE_EXIT="exited with status $status"
    fi
  fi
}

# The engine's own lines plus pid-less ones (crashpad's). Prints from the
# signal to the end of the stack trace when there is one, since a fixed tail
# can cut off the crashing frame.
engine_last_words() { # $1 the engine's pid, $2 its log
  local own
  own="$(awk -v own="[$1:" '!/^\[[0-9]+:[0-9]+:/ || index($0, own) == 1' "$2")"
  if printf '%s\n' "$own" | grep -qF 'Received signal'; then
    printf '%s\n' "$own" | sed -n '/Received signal/,/\[end of stack trace\]/p'
  else
    printf '%s\n' "$own" | tail -30
  fi
}

# The IPC socket of the sway this is a client of.
#
# Use `SWAYSOCK` if set. `under-wayland.sh` starts sway rather than being
# started by it, so otherwise look for
# `$XDG_RUNTIME_DIR/sway-ipc.<uid>.<pid>.sock` with a live pid (a killed sway
# leaves its socket). Refuse if there is not exactly one, to avoid binding in
# the wrong compositor.
host_ipc_socket() {
  local candidate pid live=()
  if [ -n "${SWAYSOCK:-}" ]; then
    echo "$SWAYSOCK"
    return 0
  fi
  for candidate in "$XDG_RUNTIME_DIR"/sway-ipc.*.sock; do
    pid="${candidate%.sock}"
    pid="${pid##*.}"
    [ -e "/proc/$pid" ] && live+=("$candidate")
  done
  if [ ${#live[@]} -ne 1 ]; then
    echo "no single running sway in $XDG_RUNTIME_DIR to install a binding in: ${#live[@]} with a live pid" >&2
    return 1
  fi
  echo "${live[0]}"
}

# Presses keys through a separate virtual keyboard, under this guard's marker.
press() { # wtype arguments
  env "$(compositor_env)" "${WTYPE[@]}" "$@" >>"$KEYBOARD_LOG" 2>&1
}

# 1. Put a keyboard on the host seat before starting the engine. A headless
#    sway has none otherwise, and the engine requests no inhibitor without one.
#    See `guard-shortcuts-inhibitor.sh`.
KEYBOARD_UP=0
: >"$KEYBOARD_LOG"
if [ ${#WTYPE[@]} -eq 0 ]; then
  echo "no wtype and no nix to fetch one, so no key can be pressed" >&2
elif ! "${WTYPE[@]}" -k Shift_L -s 1 >"$KEYBOARD_LOG" 2>&1; then
  echo "no virtual keyboard could be made on $WAYLAND_DISPLAY. wtype said:" >&2
  tail -5 "$KEYBOARD_LOG" >&2
else
  env "$(compositor_env)" \
    "${WTYPE[@]}" -k Shift_L -s "$KEYBOARD_LIVES_FOR_MS" >>"$KEYBOARD_LOG" 2>&1 &
  sleep 1
  KEYBOARD_UP=1
  echo "a virtual keyboard is on the host's seat"
fi

# 2. The host observer: a binding whose command writes a line. `echo` is a
#    shell builtin, so the command needs nothing on sway's PATH.
if [ ${#SWAYMSG[@]} -eq 0 ]; then
  echo "no swaymsg and no nix to fetch one, so no binding can be installed" >&2
elif ! SOCKET="$(host_ipc_socket)"; then
  echo "the host is not a sway this can reach, so no binding can be installed" >&2
else
  SWAYMSG+=(-s "$SOCKET")
  if "${SWAYMSG[@]}" -- bindsym --no-warn "$CHORD" exec echo took ">>$HOST_LOG"; then
    BOUND=1
    echo "$CHORD is bound on the host"
  else
    echo "sway at $SOCKET refused the binding" >&2
  fi
fi

# 3. Host calibration: press the chord with no client. The binding must fire;
#    later firings are counted from here.
HOST_CALIBRATED=0
if [ "$KEYBOARD_UP" = "1" ] && [ "$BOUND" = "1" ]; then
  press -M logo -k "$CHORD_KEY" -m logo
  if wait_until "$KEY_SECONDS" host_fired_past 0; then
    HOST_CALIBRATED=1
    echo "the host took $CHORD with nothing focused, so its binding can be seen firing"
  else
    echo "$CHORD pressed at an empty host and the binding never fired" >&2
  fi
fi
HOST_BEFORE="$(host_fired)"

# 3b. Restore a seat keyboard. The calibration's wtype exited and left the
#    seat with no active keyboard, so a new client gets modifiers before a
#    keymap; the engine then segfaults in `xkb_state_update_mask` under
#    `WaylandKeyboard::OnModifiers` (crux run 36232746099). A held Shift_L
#    makes this wtype the seat keyboard for the rest of the run.
if [ "$KEYBOARD_UP" = "1" ]; then
  env "$(compositor_env)" \
    "${WTYPE[@]}" -k Shift_L -s "$KEYBOARD_LIVES_FOR_MS" >>"$KEYBOARD_LOG" 2>&1 &
  sleep 1
fi

# 4. The engine, nested, on a domicile:// document, with or without the
#    switch. `--app` avoids a tab strip above the shell.
if [ "$NEGATIVE" = "1" ]; then
  SWITCH=()
  echo "starting the engine WITHOUT --domicile-inhibit-host-shortcuts"
else
  SWITCH=(--domicile-inhibit-host-shortcuts)
  echo "starting the engine with --domicile-inhibit-host-shortcuts"
fi
rm -f "$ENGINE_LOG"
env "$(compositor_env)" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app=domicile://shell/ \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shortcuts-inhibitor-chord.js" \
  "${SWITCH[@]}" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE_PID=$!
ENGINE_EXIT=""
ENGINE_FOUND_DEAD=""

# 5. Wait for the page observer and for focus. Not fatal here; the verdict
#    reports what is missing.
wait_until "$FOR_SECONDS" page_said "listening" ||
  echo "the page never said it was listening" >&2
wait_until "$FOR_SECONDS" page_said "focused" ||
  echo "the page never had focus" >&2
engine_check "before the plain key"

# 6. Page calibration: a key the host does not bind.
if [ "$KEYBOARD_UP" = "1" ]; then
  press -k "$PLAIN_KEY"
  wait_until "$KEY_SECONDS" page_said "keydown key=$PLAIN_KEY meta=(true|false)" ||
    echo "the plain key never reached the page" >&2
fi
engine_check "before the chord"

# 7. The chord. Wait until one side has it, then give the other side time to
#    report it too.
if [ "$KEYBOARD_UP" = "1" ]; then
  press -M logo -k "$CHORD_KEY" -m logo
  wait_until "$KEY_SECONDS" chord_landed ||
    echo "$CHORD reached neither side in $KEY_SECONDS seconds" >&2
  sleep "$SETTLE_SECONDS"
fi
engine_check "after the chord"

# The readings, in header order.
LISTENING=$(page_saw "listening")
FOCUSED=$(page_saw "focused")
PLAIN_ARRIVED=$(page_saw "keydown key=$PLAIN_KEY meta=(true|false)")
PAGE_TOOK=$(page_saw "keydown key=$CHORD_KEY meta=(true|false)")
PAGE_META=$(page_saw "keydown key=$CHORD_KEY meta=true")
HOST_TOOK=$([ "$(host_fired)" -gt "$HOST_BEFORE" ] && echo 1 || echo 0)

echo
echo "engine=${ENGINE_EXIT:-running}"
echo "keyboard=$KEYBOARD_UP bound=$BOUND calibrated=$HOST_CALIBRATED listening=$LISTENING focused=$FOCUSED plain=$PLAIN_ARRIVED"
echo "the chord: host=$HOST_TOOK page=$PAGE_TOOK meta=$PAGE_META"
echo

# The verdict. `scripts/test-shortcuts-inhibitor-chord-guard.sh` runs this
# block directly. Both modes pass the same gates first, so a blind observer
# cannot produce a pass.
FAILURE=""
PASSED=""
if [ -n "$ENGINE_EXIT" ]; then
  if [ "$PAGE_TOOK" = "1" ]; then
    REACHED="after the chord reached the page"
  elif [ "$PLAIN_ARRIVED" = "1" ]; then
    REACHED="after the plain key reached the page"
  elif [ "$LISTENING" = "1" ]; then
    REACHED="after the listener attached"
  else
    REACHED="before the listener attached"
  fi
  FAILURE="the engine $ENGINE_EXIT, $REACHED, and the guard found it dead \
$ENGINE_FOUND_DEAD. Every reading after that is of a page that was no longer \
there, so nothing was measured and no reading here is a cause. What it wrote \
as it died, and where its core went, are below"
elif [ "$KEYBOARD_UP" != "1" ]; then
  FAILURE="no virtual keyboard came up on the host's seat, so no key was \
pressed and nothing was measured — not the host declining a chord and not the \
page missing one. The keyboard log beside this run's engine log says what \
wtype said"
elif [ "$BOUND" != "1" ]; then
  FAILURE="no binding was installed on the host, so the host's side of this \
cannot see: a chord no binding matches is taken by nothing, whatever the \
inhibitor does. This needs a sway it can reach over IPC — under-wayland.sh's, \
or a session that exports SWAYSOCK"
elif [ "$HOST_CALIBRATED" != "1" ]; then
  FAILURE="the host's binding did not fire for the chord pressed with nothing \
focused, before the engine existed. So it does not fire for this keyboard at \
all, or cannot run its command, and 'the host did not take it' would read the \
same whatever the inhibitor did. Nothing was measured"
elif [ "$LISTENING" != "1" ]; then
  FAILURE="the page never said its listener was attached, so the page's side \
of this cannot see and 'the page did not get it' would read the same whatever \
the inhibitor did. That is the engine or its page: the engine's log says how \
far it got"
elif [ "$PLAIN_ARRIVED" != "1" ] && [ "$FOCUSED" != "1" ]; then
  FAILURE="the window never had focus and the plain key never reached the \
page, so no key could have: the host never gave the window the keyboard. \
Nothing was measured"
elif [ "$PLAIN_ARRIVED" != "1" ]; then
  FAILURE="the page had focus and the plain key '$PLAIN_KEY', which the host \
has no binding for, never reached it. So keys from this keyboard do not reach \
the page at all, and the chord not reaching it would say nothing about the \
inhibitor"
elif [ "$HOST_TOOK" != "1" ] && [ "$PAGE_TOOK" != "1" ]; then
  FAILURE="the chord went nowhere: the host's binding did not fire and the page \
got no '$CHORD_KEY', though both were shown able to see a key. That is not the \
host declining it and not the page missing it; it is a key lost between them, \
and neither run can say which side of the inhibitor that is"
elif [ "$HOST_TOOK" = "1" ] && [ "$PAGE_TOOK" = "1" ]; then
  FAILURE="both sides took the chord. sway sends a key its binding matched to \
nobody, so one press cannot do this — something else pressed '$CHORD_KEY', or \
the binding fired for a key it did not match, and neither reading is about the \
inhibitor"
elif [ "$NEGATIVE" = "1" ]; then
  if [ "$PAGE_TOOK" = "1" ]; then
    FAILURE="the control ran WITHOUT --domicile-inhibit-host-shortcuts and the \
chord reached the page anyway, with the host's binding shown firing moments \
earlier. So the switch is not what put it there, and the positive run's pass \
would not be the inhibitor's doing"
  else
    PASSED="without the switch the host took the chord and the page did not, \
over a page that heard the plain key — so the positive run's reading is the \
inhibitor's doing"
  fi
elif [ "$HOST_TOOK" = "1" ]; then
  FAILURE="--domicile-inhibit-host-shortcuts was passed, the window had the \
keyboard, and the host's binding took $CHORD anyway. So a nested desktop's \
Meta chords go to the session it runs in. guard-shortcuts-inhibitor.sh says \
whether the engine asked; if it did, the host did not honor it"
elif [ "$PAGE_META" != "1" ]; then
  PASSED="with the switch the chord's key reached the page and the host's \
binding did not fire: the host honored the inhibitor. WITH ONE READING SHORT: \
the page read the key without metaKey, so a shell matching Meta+$CHORD_KEY \
would not have matched it. Which side took it does not depend on that; \
whether a shell can use it does"
else
  PASSED="with the switch $CHORD reached the page, with metaKey, and the \
host's binding did not fire: the host honored the inhibitor"
fi

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-shortcuts-inhibitor-chord: $FAILURE"
# A dead engine's own last lines. Its children keep writing to the same log
# after it dies, so filter to the browser's lines and crashpad's pid-less ones.
# Show where the core went, since crashpad may fail to capture a stack.
if [ -n "$ENGINE_EXIT" ]; then
  echo "what the engine (pid $ENGINE_PID) wrote before it died:" >&2
  engine_last_words "$ENGINE_PID" "$ENGINE_LOG" | cut -c1-200 | sed 's/^/  /' >&2
  echo "where its core went: core_pattern '$(cat /proc/sys/kernel/core_pattern)', ulimit -c $(ulimit -c)" >&2
  if command -v coredumpctl >/dev/null; then
    echo "what systemd-coredump kept of it:" >&2
    coredumpctl info --no-pager "$ENGINE_PID" 2>&1 | head -60 | cut -c1-200 |
      sed 's/^/  /' >&2
  else
    echo "no coredumpctl on PATH, so no stack from its core" >&2
  fi
fi
echo "what the page said:" >&2
grep -aE '"GUARD ' "$ENGINE_LOG" | tail -10 | cut -c1-200 | sed 's/^/  /' >&2
echo "what the engine said about the inhibitor:" >&2
grep -aE 'domicile:|ERROR' "$ENGINE_LOG" | tail -10 | cut -c1-200 |
  sed 's/^/  /' >&2
echo "the host's binding fired $(host_fired) time(s), $HOST_BEFORE of them before the engine started" >&2
echo "what the virtual keyboard said ($KEYBOARD_LOG):" >&2
tail -5 "$KEYBOARD_LOG" | sed 's/^/  /' >&2
exit 1
