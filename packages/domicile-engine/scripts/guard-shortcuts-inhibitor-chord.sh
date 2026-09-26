#!/usr/bin/env bash
# A Meta chord pressed into the nested session, and which side took it.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/under-wayland.sh /build/chromium/src \
#     ./packages/domicile-engine/scripts/guard-shortcuts-inhibitor-chord.sh /build/chromium/src
#
# WHAT THIS PROVES. With `--domicile-inhibit-host-shortcuts`, a chord the host
# compositor has a binding for, pressed while the desktop's window has the
# keyboard, reaches the page and does not fire the host's binding. Without the
# switch, the same chord fires the binding and does not reach the page. So the
# host honored the inhibitor patch `0038` asked for, and the switch is what
# decides which side a chord lands on.
#
# WHAT IT DOES NOT PROVE: that any host other than sway honors the inhibitor,
# that a physical keyboard's keys go the way a virtual one's do, that a shell's
# SDK does anything useful with the key once it has it, or that the window
# keeps the chords once another client has had the keyboard. And it is the
# engine alone under sway, as `guard-shortcuts-inhibitor.sh` is, with the
# switch passed by hand; `domicile-launch` is what passes it in a desktop.
#
# A GUARD OF ITS OWN, NOT MORE OF `guard-shortcuts-inhibitor.sh`, for three
# reasons. That guard's claim is the request on the wire, and it is kept narrow
# on purpose: a pass there says the engine ASKED, and a pass here says the host
# did what it was asked. One exit status cannot carry both, and when the two
# disagree — the request made and the chord still taken — that disagreement is
# the finding, and it is only readable if they are two checks. Second, this
# needs sway: the host's side of the reading is a binding installed over sway's
# IPC, and the request guard runs under any host that carries the protocol,
# including a person's own session. Third, that guard's instrument is
# `WAYLAND_DEBUG=1`, which puts every key and frame on the wire into the log
# this guard reads the page's console out of.
#
# TWO OBSERVERS, ONE ON EACH SIDE, because the question is WHICH side took the
# key and a reading on one side alone answers "not here" in the same voice for
# "the other side took it" and "it went nowhere":
#
#   the host   a sway binding on the chord, installed over IPC, whose command
#              appends a line to `$HOST_LOG`. sway matches its bindings before
#              it sends a key to the focused client and sends a matched key to
#              nobody, so a line there is the host having taken it
#   the page   `guard-shortcuts-inhibitor-chord.js`, which logs every keydown
#              that reaches its document to the console, which the engine
#              writes to its own log
#
# AND EACH IS SHOWN TO SEE BEFORE IT IS BELIEVED NOT TO. Both claims rest on an
# absence, and an absence is what a blind observer reports:
#
#   the host's binding fires   the chord is pressed once BEFORE the engine is
#     with nothing focused     started, at a compositor with no client in it and
#                              so nothing to inhibit anything. It must write its
#                              line, or the binding is not installed, not
#                              matched for this keyboard, or cannot run its
#                              command — and "the host did not take it" would be
#                              true of every run
#   a plain key reaches the    a key sway has no binding for, pressed once the
#     page                     window is up. It must arrive, or the window does
#                              not have the keyboard or the listener hears
#                              nothing — and "the page did not get it" would be
#                              true of every run
#
# THE KEYS. `$CHORD_KEY` with Mod4 is the chord, and `$PLAIN_KEY` alone is the
# plain key — a different key, so the page's reading of the chord cannot be
# satisfied by the key that proved it could hear. Neither is a key sway's
# default config binds with Mod4, because this also runs under a person's own
# sway session, where the binding is taken out again on the way out.
#
# WHAT IT READS, each only worth anything if the one above it holds:
#
#   the engine is still running   or every reading after it died is a dead
#                                 page's silence, and read as a cause
#   a virtual keyboard came up    or nothing was pressed at all
#   the binding was installed     swaymsg said so
#   the binding fired, unfocused  the calibration above
#   the page is listening         `GUARD listening`
#   the plain key reached it      the other calibration; `GUARD focused` names
#                                 which half is missing when it did not
#   the chord went somewhere      one side or the other, or a key that went
#                                 nowhere is not read as the host declining it
#   which side took it            THE CLAIM
#
# HOW IT CAN FAIL. `NEGATIVE=1` is the same run with
# `--domicile-inhibit-host-shortcuts` left off, and the chord must then fire the
# binding and NOT reach the page. It passes through the same gates first,
# because a control that could not have seen the page get the key has
# established nothing by the page not getting it. One switch is the whole
# difference between the runs, so a page that gets the chord only with it is a
# page that gets it because of it.
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

# NEGATIVE=1 runs the same thing without the switch. See the header.
NEGATIVE="${NEGATIVE:-0}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shortcuts-inhibitor-chord-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shortcuts-inhibitor-chord-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# How long the engine is given to load its page and the window to be given the
# keyboard. Generous, because a cold start on a shared machine is most of it and
# each wait ends the moment its line lands.
FOR_SECONDS="${FOR_SECONDS:-90}"

# How long a key is given to land. A key is a message to sway and one from it,
# so this is slack for a busy machine rather than a budget.
KEY_SECONDS="${KEY_SECONDS:-15}"

# How long the side that did NOT take the chord is given to say otherwise. One
# of the two readings is always an absence, and an absence can only be given
# time.
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"

# The keyboard outlives the run for the reason `guard-shortcuts-inhibitor.sh`
# gives: the seat's keyboard capability goes with it, and the engine decides
# whether to ask for an inhibitor once, where the window is set up.
KEYBOARD_LIVES_FOR_MS="${KEYBOARD_LIVES_FOR_MS:-300000}"

# The chord and the plain key. See the header.
CHORD_KEY="y"
PLAIN_KEY="u"
CHORD="Mod4+$CHORD_KEY"

# A run and its own control are two measurements, so they get two sets of logs.
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shortcuts-inhibitor-chord$WHICH-engine.log}"
KEYBOARD_LOG="${KEYBOARD_LOG:-/tmp/domicile-shortcuts-inhibitor-chord$WHICH-keyboard.log}"
HOST_LOG="${HOST_LOG:-/tmp/domicile-shortcuts-inhibitor-chord$WHICH-host.log}"

# EVERYTHING THIS STARTS IS GONE BEFORE IT RETURNS, for the reason
# `guard-shortcuts-inhibitor.sh` gives at length: the keyboard is `wtype`
# behind a `nix shell` wrapper and the engine a browser with children, so
# neither pid a `&` hands back is the one that lives. Both carry
# `lib-compositor-cleanup.sh`'s marker naming this guard.
#
# AND SO IS THE BINDING. Under `under-wayland.sh` the sway it went into dies
# after this returns, but a person's own session does not, and a Mod4 chord
# left bound to a line in a log is a key taken off them.
# `scripts/test-the-shortcuts-guards-leave-nothing-running.sh` holds both.
BOUND=0
cleanup() {
  if [ "$BOUND" = "1" ]; then
    "${SWAYMSG[@]}" -- unbindsym "$CHORD" >/dev/null
  fi
  kill_compositors "$(compositor_owner)"
  wait
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

# `wtype` and `swaymsg` live in nixpkgs rather than in either dev shell, and
# are fetched the way `under-wayland.sh` fetches sway. `swaymsg` from the same
# package, so it speaks the IPC of the sway that script started.
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
# Empty rather than absent, so that a count of its lines is a count and not an
# error, and so that a line in it is this run's.
: >"$HOST_LOG"

# Whether the page said `$1`, as `1` or `0`.
#
# THE QUOTES ARE LOAD-BEARING. Chromium writes a console line as
# `[...:INFO:CONSOLE:48] "GUARD keydown key=y meta=true", source: ...`, so a
# message never ends where the line does — and without the closing quote,
# `key=y` would match a key whose name begins with `y`.
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

# Whether the engine is still running, as opposed to gone or a zombie nobody
# has reaped yet: field 3 of stat. `ENGINE_PID` is the browser's own pid,
# because `env` execs it.
engine_running() {
  local stat
  stat="$( { cat "/proc/$ENGINE_PID/stat"; } 2>/dev/null )"
  [ -n "$stat" ] && [ "$(printf '%s\n' "${stat##*) }" | awk '{ print $1 }')" != Z ]
}

# How the engine ended, and where the guard was when it first found it so. A
# later check does not move that. `wait` hands back the status of a child bash
# has already reaped, which is what makes the signal a reading rather than a
# line bash prints and the verdict never sees.
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

# The sway this is a client of, by its IPC socket.
#
# A session exports `SWAYSOCK` to what it starts, and a person's own does.
# `under-wayland.sh` starts sway rather than being started by it, so the socket
# is found where sway makes it — `$XDG_RUNTIME_DIR/sway-ipc.<uid>.<pid>.sock` —
# and only one whose sway is still running counts: a sway killed outright leaves
# its socket behind. Two live ones is two sessions, and picking one would be
# installing the binding in a compositor this guard may not be a client of.
# Its own lines and the pid-less ones. From the signal to the end of the stack
# when there is one, whole: crux's stack was 32 frames and a tail of 30 lines
# kept the bottom of it, so the frame naming what crashed was the one missing.
engine_last_words() { # $1 the engine's pid, $2 its log
  local own
  own="$(awk -v own="[$1:" '!/^\[[0-9]+:[0-9]+:/ || index($0, own) == 1' "$2")"
  if printf '%s\n' "$own" | grep -qF 'Received signal'; then
    printf '%s\n' "$own" | sed -n '/Received signal/,/\[end of stack trace\]/p'
  else
    printf '%s\n' "$own" | tail -30
  fi
}

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

# Presses keys through a virtual keyboard of their own, under this guard's
# marker like everything else it starts.
press() { # wtype arguments
  env "$(compositor_env)" "${WTYPE[@]}" "$@" >>"$KEYBOARD_LOG" 2>&1
}

# 1. A keyboard on the host's seat, before the engine is started, exactly as
#    `guard-shortcuts-inhibitor.sh` puts one there and for its reasons: without
#    it a headless sway announces no keyboard, and the engine asks for no
#    inhibitor against a seat without one. Here it is also the only way a key
#    gets in at all, so the verdict refuses a run where it did not come up.
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

# 2. The host's observer: a binding on the chord whose command writes a line.
#    `echo` because it is the shell's own, so the command sway runs needs
#    nothing on its PATH but the `sh` it runs it with.
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

# 3. THE HOST'S CALIBRATION: the chord, with no client on the host at all. The
#    binding must fire, and what it wrote is the count the chord proper is read
#    against.
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

# 3b. THE SEAT'S KEYBOARD, AGAIN. That press was a wtype of its own, and when it
#    exited sway's seat was left with no active keyboard: a client binding the
#    keyboard then gets no keymap before its first modifiers, and the engine
#    segfaulted on exactly that, in `xkb_state_update_mask` under
#    `WaylandKeyboard::OnModifiers` (crux run 36232746099). The request guard
#    never presses, which is why it never crashed. A hold presses Shift_L
#    first, which makes it the seat's keyboard, keymap and all, and it outlives
#    the engine; under the marker, so cleanup takes it with the rest.
if [ "$KEYBOARD_UP" = "1" ]; then
  env "$(compositor_env)" \
    "${WTYPE[@]}" -k Shift_L -s "$KEYBOARD_LIVES_FOR_MS" >>"$KEYBOARD_LOG" 2>&1 &
  sleep 1
fi

# 4. The engine, nested, on a domicile:// document, with the switch or without
#    it. `--app` for the reason every guard here repeats: a tab strip above the
#    shell is the difference between a desktop and a browser looking at a page.
if [ "$NEGATIVE" = "1" ]; then
  SWITCH=()
  echo "starting the engine WITHOUT --domicile-inhibit-host-shortcuts"
else
  SWITCH=(--domicile-inhibit-host-shortcuts)
  echo "starting the engine with --domicile-inhibit-host-shortcuts"
fi
env "$(compositor_env)" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=wayland \
  --app=domicile://shell/ \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shortcuts-inhibitor-chord.js" \
  "${SWITCH[@]}" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --window-size="$WIDTH,$HEIGHT" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE_PID=$!
ENGINE_EXIT=""
ENGINE_FOUND_DEAD=""

# 5. The page's observer, and the window having the keyboard. Neither is fatal
#    here: the verdict says what a run without them measured, and says it once.
wait_until "$FOR_SECONDS" page_said "listening" ||
  echo "the page never said it was listening" >&2
wait_until "$FOR_SECONDS" page_said "focused" ||
  echo "the page never had focus" >&2
engine_check "before the plain key"

# 6. THE PAGE'S CALIBRATION: a key the host has no binding for.
if [ "$KEYBOARD_UP" = "1" ]; then
  press -k "$PLAIN_KEY"
  wait_until "$KEY_SECONDS" page_said "keydown key=$PLAIN_KEY meta=(true|false)" ||
    echo "the plain key never reached the page" >&2
fi
engine_check "before the chord"

# 7. THE CHORD. Waited for until one side has it, and then the other side is
#    given its time to say it has it too.
if [ "$KEYBOARD_UP" = "1" ]; then
  press -M logo -k "$CHORD_KEY" -m logo
  wait_until "$KEY_SECONDS" chord_landed ||
    echo "$CHORD reached neither side in $KEY_SECONDS seconds" >&2
  sleep "$SETTLE_SECONDS"
fi
engine_check "after the chord"

# THE READINGS, in the order the header lists them.
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

# WHICH SIDE, and it is the whole of this script's judgment — decided here, in
# a block `scripts/test-shortcuts-inhibitor-chord-guard.sh` runs directly,
# rather than inferred from two logs by whoever opens the job. Every gate above
# the mode is one both runs pass through, because each of them is an observer
# that could not have seen, and a blind observer's "not here" is the cheapest
# pass either run has.
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
# A DEAD ENGINE'S OWN LAST WORDS. Its children outlive it and go on writing to
# the same log — on crux one wrote TLS errors for seventeen seconds after the
# browser segfaulted, and they were all the log's tail showed — so these are
# the browser's own lines and the ones with no pid on them, which is how
# crashpad writes. The core is where a stack would be: crashpad's handler
# replaces base's in-process one, and on crux it failed to read the process.
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
