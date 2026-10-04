#!/usr/bin/env bash
# Tests which side `guard-shortcuts-inhibitor-chord.sh` says took the chord,
# and what it refuses to count as a measurement.
#
# Runs these pieces from the real script:
#
#   the verdict block   turns the readings and mode into a pass or a failure
#   the readings        greps over the page console and host binding log
#   host_ipc_socket     finds the sway the binding is installed in
#   engine_check        reports whether the engine is running and how it ended
#
# Both claims are absences: one side did not take the key. An absence also
# results from a missing binding, keyboard, listener or focus, so each reading
# has a gate before it proving the observer could see. Most cases test the
# order of those gates.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shortcuts-inhibitor-chord.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the closing `fi` at column zero. Nested `fi`s are
# indented, and the block stops before the `if [ -n "$PASSED" ]` below it.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

# A guard function, from its first line to its closing brace.
function_in_guard() { # name
  awk "/^$1\\(\\) \\{/,/^\\}/" "$GUARD"
}

# The readings, from the first through `HOST_TOOK`, plus the two helper
# functions they call.
READINGS="$(function_in_guard page_saw)
$(function_in_guard host_fired)
$(awk '/^LISTENING=\$\(page_saw /,/^HOST_TOOK=/' "$GUARD")"
[ "$(printf '%s\n' "$READINGS" |
     grep -cE '^(page_saw\(\) \{|host_fired\(\) \{|LISTENING=|HOST_TOOK=)')" -eq 4 ] || {
  echo "no readings block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

SOCKET_FINDER="$(function_in_guard host_ipc_socket)"
[ -n "$SOCKET_FINDER" ] || {
  echo "no host_ipc_socket() in $GUARD — it moved. Fix this test with it." >&2
  exit 1
}

ENGINE_WATCH="$(function_in_guard engine_running)
$(function_in_guard engine_check)"
[ "$(printf '%s\n' "$ENGINE_WATCH" | grep -cE '^engine_(running|check)\(\) \{')" -eq 2 ] || {
  echo "no engine_running() and engine_check() in $GUARD — they moved. Fix this test with it." >&2
  exit 1
}

# The key names the readings and verdict use.
KEYS="$(grep -E '^((CHORD|PLAIN)_KEY|CHORD)="' "$GUARD")"
[ "$(printf '%s\n' "$KEYS" | grep -c .)" -eq 3 ] || {
  echo "no CHORD_KEY, PLAIN_KEY and CHORD in $GUARD — they moved. Fix this test with it." >&2
  exit 1
}
eval "$KEYS"

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# ---------------------------------------------------------------------------
# The verdict.

# A passing positive run; each case overrides one reading by name.
readings() { # $1 NEGATIVE, then NAME=value overrides
  KEYBOARD_UP=1
  BOUND=1
  HOST_CALIBRATED=1
  LISTENING=1
  FOCUSED=1
  PLAIN_ARRIVED=1
  HOST_TOOK=0
  PAGE_TOOK=1
  PAGE_META=1
  ENGINE_EXIT=""
  ENGINE_FOUND_DEAD=""
  NEGATIVE="$1"
  shift
  for override in "$@"; do
    eval "$override"
  done
}

# The control's baseline: the host took the chord and the page did not.
CONTROL=(HOST_TOOK=1 PAGE_TOOK=0 PAGE_META=0)

verdict() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

# The verdict sentence, for cases that check which side it names. Match
# words, not the whole sentence, so rewording does not break the test.
sentence() { # $1 NEGATIVE, then NAME=value overrides
  (
    readings "$@"
    eval "$BLOCK"
    echo "$FAILURE$PASSED"
  )
}

names() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(sentence "$@")" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "the engine died"
# A dead page takes no keys, which the gates below would misread as a cause
# such as missing focus. So a dead engine is the verdict, checked first, and
# names no other cause.
CRASH=("ENGINE_EXIT='crashed, killed by signal 11 (SEGV)'"
       "ENGINE_FOUND_DEAD='before the plain key'")
CRUX=(FOCUSED=0 PLAIN_ARRIVED=0 HOST_TOOK=1 PAGE_TOOK=0 PAGE_META=0)
expect "an engine that died is a failure" "fail" \
  "$(verdict 0 "${CRASH[@]}" "${CRUX[@]}")"
expect "an engine that died says it crashed, and how" "yes" \
  "$(names "crashed, killed by signal 11 (SEGV)" 0 "${CRASH[@]}" "${CRUX[@]}")"
expect "an engine that died says how far it got" "yes" \
  "$(names "after the listener attached, and the guard found it dead before the plain key" \
       0 "${CRASH[@]}" "${CRUX[@]}")"
for other in focus host keyboard binding nowhere; do
  expect "an engine that died names no other cause: not '$other'" "no" \
    "$(names "$other" 0 "${CRASH[@]}" "${CRUX[@]}")"
done
# A dead page takes no key and the host takes the chord, which looks like a
# control pass.
expect "an engine that died is a failure in the control too" "fail" \
  "$(verdict 1 "${CRASH[@]}" "${CRUX[@]}")"
# A crash outranks every other cause.
expect "a crash outranks a keyboard that never came up" "yes" \
  "$(names "crashed" 0 KEYBOARD_UP=0 "${CRASH[@]}" "${CRUX[@]}")"
# An engine that passed and then died still fails.
expect "a crash outranks a pass" "fail" "$(verdict 0 "${CRASH[@]}")"
# How far the page got comes from what it logged before dying.
expect "a crash before the listener says so" "yes" \
  "$(names "before the listener attached" 0 LISTENING=0 "${CRASH[@]}" "${CRUX[@]}")"
expect "a crash after the plain key says so" "yes" \
  "$(names "after the plain key reached the page" 0 "${CRASH[@]}" "${CRUX[@]}" PLAIN_ARRIVED=1)"
expect "a crash after the chord says so" "yes" \
  "$(names "after the chord reached the page" 0 "${CRASH[@]}")"

echo
echo "no key could be pressed"
expect "no virtual keyboard is a failure" "fail" "$(verdict 0 KEYBOARD_UP=0)"
expect "no virtual keyboard names the keyboard" "yes" \
  "$(names "virtual keyboard" 0 KEYBOARD_UP=0)"
# With no keyboard nothing is pressed, so "the page did not get it" holds for
# any page.
expect "no virtual keyboard is a failure in the control too" "fail" \
  "$(verdict 1 KEYBOARD_UP=0 "${CONTROL[@]}")"

echo
echo "the host's side cannot see"
# With no binding, or one that does not fire for this keyboard, sway takes
# nothing regardless of the inhibitor.
expect "a binding that was never installed is a failure" "fail" \
  "$(verdict 0 BOUND=0)"
expect "a binding that was never installed names the binding" "yes" \
  "$(names "binding" 0 BOUND=0)"
expect "a binding that never fired unfocused is a failure" "fail" \
  "$(verdict 0 HOST_CALIBRATED=0)"
expect "a binding that never fired names what it was pressed at" "yes" \
  "$(names "nothing focused" 0 HOST_CALIBRATED=0)"
expect "a binding that never fired is a failure in the control too" "fail" \
  "$(verdict 1 HOST_CALIBRATED=0 "${CONTROL[@]}")"

echo
echo "the page's side cannot see"
# A page that never listened, never had focus, or got no key did not get the
# chord for reasons unrelated to the switch.
expect "a page that never listened is a failure" "fail" \
  "$(verdict 1 LISTENING=0 PLAIN_ARRIVED=0 "${CONTROL[@]}")"
expect "a page that never listened names the listener" "yes" \
  "$(names "listener" 1 LISTENING=0 PLAIN_ARRIVED=0 "${CONTROL[@]}")"
expect "a window that never had the keyboard is a failure" "fail" \
  "$(verdict 1 FOCUSED=0 PLAIN_ARRIVED=0 "${CONTROL[@]}")"
expect "a window that never had the keyboard names focus" "yes" \
  "$(names "focus" 1 FOCUSED=0 PLAIN_ARRIVED=0 "${CONTROL[@]}")"
expect "a focused page no key reached is a failure" "fail" \
  "$(verdict 1 PLAIN_ARRIVED=0 "${CONTROL[@]}")"
expect "a focused page no key reached names the plain key" "yes" \
  "$(names "$PLAIN_KEY" 1 PLAIN_ARRIVED=0 "${CONTROL[@]}")"
# The document may report focus just before or after the key arrives. The key
# arriving decides, and it outranks the focus reading.
expect "a plain key that arrived is focus enough" "pass" \
  "$(verdict 0 FOCUSED=0)"

echo
echo "the chord went nowhere, or everywhere"
# Both observers could see and neither saw the chord. That is neither "the
# host did not take it" nor "the page did not get it".
expect "a chord nobody took is a failure" "fail" \
  "$(verdict 0 PAGE_TOOK=0 PAGE_META=0)"
expect "a chord nobody took says it went nowhere" "yes" \
  "$(names "went nowhere" 0 PAGE_TOOK=0 PAGE_META=0)"
expect "a chord nobody took is a failure in the control too" "fail" \
  "$(verdict 1 HOST_TOOK=0 PAGE_TOOK=0 PAGE_META=0)"
expect "a chord both sides took is a failure" "fail" "$(verdict 0 HOST_TOOK=1)"
expect "a chord both sides took is a failure in the control too" "fail" \
  "$(verdict 1 HOST_TOOK=1)"

echo
echo "the run — with the switch, the page takes it and the host does not"
expect "the page and not the host is the pass" "pass" "$(verdict 0)"
expect "the pass names the inhibitor" "yes" \
  "$(names "inhibitor" 0)"
expect "the host taking it is the failure" "fail" \
  "$(verdict 0 HOST_TOOK=1 PAGE_TOOK=0 PAGE_META=0)"
expect "the host taking it names the switch" "yes" \
  "$(names "domicile-inhibit-host-shortcuts" 0 HOST_TOOK=1 PAGE_TOOK=0 PAGE_META=0)"
# Which side took the key is decided regardless of modifiers. A key without
# Meta is not a usable chord for a shell matching Meta, so the pass says so.
expect "the chord's key without Meta still decides which side took it" "pass" \
  "$(verdict 0 PAGE_META=0)"
expect "and says Meta did not arrive" "yes" \
  "$(names "metaKey" 0 PAGE_META=0)"

echo
echo "the control — without the switch, the host takes it and the page does not"
expect "the host and not the page is the control's pass" "pass" \
  "$(verdict 1 "${CONTROL[@]}")"
expect "the page taking it without the switch is a failure" "fail" "$(verdict 1)"
expect "the page taking it without the switch names the switch" "yes" \
  "$(names "domicile-inhibit-host-shortcuts" 1)"

# ---------------------------------------------------------------------------
# The readings, over the lines the engine writes.
#
# A reading that cannot match returns zero, the same as a key that never
# arrived. So run them over Chromium's console line format, as recorded in
# `scripts/test-control-arrival-guard.sh`.
echo
echo "what the readings read"
CONSOLE='[1656824:1656824:0911/102653.088606:INFO:CONSOLE:48] "GUARD %s", source: domicile://shell/guard-shortcuts-inhibitor-chord.js (48)'

logged() { # every argument is one GUARD message
  local message
  for message in "$@"; do
    # shellcheck disable=SC2059
    printf "$CONSOLE\n" "$message"
  done
}

taken() { # $1 lines in the host's log, $2 lines at calibration; the page's log on stdin
  local work out
  work="$(mktemp -d)"
  cat >"$work/engine.log"
  : >"$work/host.log"
  for _ in $(seq 1 "$1"); do echo took >>"$work/host.log"; done
  out="$(ENGINE_LOG="$work/engine.log" HOST_LOG="$work/host.log" \
    HOST_BEFORE="$2" CHORD_KEY="$CHORD_KEY" PLAIN_KEY="$PLAIN_KEY" \
    bash -c 'set -u
      '"$READINGS"'
      printf "listening=%s focused=%s plain=%s page=%s meta=%s host=%s" \
        "$LISTENING" "$FOCUSED" "$PLAIN_ARRIVED" "$PAGE_TOOK" "$PAGE_META" \
        "$HOST_TOOK"')"
  rm -rf "$work"
  printf '%s' "$out"
}

expect "a positive run reads as one" \
  "listening=1 focused=1 plain=1 page=1 meta=1 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" \
       "keydown key=$CHORD_KEY meta=true" | taken 1 1)"
expect "a control reads as one" \
  "listening=1 focused=1 plain=1 page=0 meta=0 host=1" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" |
       taken 2 1)"
# The plain key names a different key, so it cannot satisfy the chord
# reading.
expect "the plain key is not the chord" \
  "listening=1 focused=1 plain=1 page=0 meta=0 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" |
       taken 1 1)"
expect "the chord's key without Meta is the page taking it, without Meta" \
  "listening=1 focused=1 plain=1 page=1 meta=0 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" \
       "keydown key=$CHORD_KEY meta=false" | taken 1 1)"
# The closing quote anchors the key name. Without it, a key whose name starts
# with the chord key's would match, as `guard-control-arrival.sh` found.
expect "a key named after the chord's is not the chord" \
  "listening=1 focused=1 plain=1 page=0 meta=0 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" \
       "keydown key=${CHORD_KEY}en meta=true" | taken 1 1)"
# The calibration press is the binding's first line, not the chord.
expect "the calibration press is not the host taking the chord" \
  "listening=0 focused=0 plain=0 page=0 meta=0 host=0" \
  "$(printf '' | taken 1 1)"

# ---------------------------------------------------------------------------
# Whether the engine is still running, over stand-ins that end as an engine
# can. The first check that finds it dead is recorded; later checks must not
# change it.
echo
echo "whether the engine is still running"
ended() { # a command standing in for the engine
  bash -c 'set -u
    ulimit -c 0
    '"$ENGINE_WATCH"'
    ENGINE_EXIT=""
    ENGINE_FOUND_DEAD=""
    '"$1"' &
    ENGINE_PID=$!
    for _ in $(seq 1 40); do engine_running || break; sleep 0.05; done
    engine_check "before the plain key"
    engine_check "before the chord"
    kill "$ENGINE_PID" 2>/dev/null
    printf "%s|%s" "$ENGINE_EXIT" "$ENGINE_FOUND_DEAD"' 2>/dev/null
}
expect "an engine killed by SIGSEGV crashed, where it was first found dead" \
  "crashed, killed by signal 11 (SEGV)|before the plain key" \
  "$(ended "sh -c 'kill -SEGV \$\$'")"
expect "an engine that exited says its status" \
  "exited with status 3|before the plain key" "$(ended "sh -c 'exit 3'")"
expect "a running engine has not ended" "|" "$(ended "sleep 60")"

# ---------------------------------------------------------------------------
# Which sway. `under-wayland.sh` exports no `SWAYSOCK`, so the guard finds
# the socket in `XDG_RUNTIME_DIR`. A killed sway leaves its socket behind, so
# only sockets with a live pid count. With more than one, the guard must
# refuse to pick.
echo
echo "which sway the binding goes into"
socket_of() { # SWAYSOCK, then pids to make sockets for
  local sock="$1" work out
  shift
  work="$(mktemp -d)"
  for pid in "$@"; do
    : >"$work/sway-ipc.$(id -u).$pid.sock"
  done
  out="$(SWAYSOCK="$sock" XDG_RUNTIME_DIR="$work" bash -c 'set -u
    [ -n "$SWAYSOCK" ] || unset SWAYSOCK
    '"$SOCKET_FINDER"'
    if found="$(host_ipc_socket 2>/dev/null)"; then
      echo "$found found"
    else
      echo " none"
    fi' |
    sed "s|$work/||")"
  rm -rf "$work"
  printf '%s' "$out"
}

sleep 60 &
LIVE_A=$!
sleep 60 &
LIVE_B=$!
sleep 0 &
DEAD=$!
wait "$DEAD"
trap 'kill "$LIVE_A" "$LIVE_B" 2>/dev/null' EXIT

expect "a session's own SWAYSOCK is the answer" "/run/session.sock found" \
  "$(socket_of /run/session.sock "$LIVE_A")"
expect "the one live sway's socket is the answer" \
  "sway-ipc.$(id -u).$LIVE_A.sock found" \
  "$(socket_of "" "$LIVE_A" "$DEAD")"
expect "a socket whose sway is gone is no answer" " none" \
  "$(socket_of "" "$DEAD")"
expect "two live sways are no answer" " none" \
  "$(socket_of "" "$LIVE_A" "$LIVE_B")"

echo "what a dead engine wrote"

LAST_WORDS="$(function_in_guard engine_last_words)"
[ -n "$LAST_WORDS" ] || {
  echo "no engine_last_words() in $GUARD — it moved. Fix this test with it." >&2
  exit 1
}
eval "$LAST_WORDS"

# The log shape from crux: browser lines, crashpad lines without a pid, a
# signal, a long stack, then a child's TLS noise. Frame #0 names the handler.
DEATH_LOG="$(mktemp)"
{
  echo '[100:100:0926/011843.401289:INFO:CONSOLE:32] "GUARD listening"'
  echo 'Received signal 11 SEGV_MAPERR 000000000000'
  for n in $(seq 0 31); do printf '#%d 0x55555c24%04d frame_%d\n' "$n" "$n" "$n"; done
  echo '  r8: 0000000000000000  r9: 0000000000000000'
  echo '[end of stack trace]'
  for n in $(seq 1 40); do
    echo "[200:201:0926/011900.2519$n:ERROR:ssl_client_socket_impl.cc:949] handshake failed"
  done
} >"$DEATH_LOG"
WORDS="$(engine_last_words 100 "$DEATH_LOG")"
expect "the signal is printed" "yes" \
  "$(printf '%s\n' "$WORDS" | grep -qF 'Received signal 11' && echo yes || echo no)"
expect "the stack's top frame is printed" "yes" \
  "$(printf '%s\n' "$WORDS" | grep -qE '#0 0x[0-9a-f]+ frame_0$' && echo yes || echo no)"
expect "and its bottom one" "yes" \
  "$(printf '%s\n' "$WORDS" | grep -qE '#31 0x[0-9a-f]+ frame_31$' && echo yes || echo no)"
expect "a child's lines are not" "no" \
  "$(printf '%s\n' "$WORDS" | grep -qF 'handshake failed' && echo yes || echo no)"

# With no stack (crashpad could not read the process), print the browser's
# last lines.
printf '[100:100:0926/011843.4:INFO:CONSOLE:32] "GUARD listening"\n' >"$DEATH_LOG"
expect "with no stack, the browser's own last line is printed" "yes" \
  "$(engine_last_words 100 "$DEATH_LOG" | grep -qF 'GUARD listening' && echo yes || echo no)"
rm -f "$DEATH_LOG"

echo "what the seat holds when the engine binds its keyboard"

# Each `press` runs its own wtype, and when it exits sway's seat has no
# keyboard. A client binding the keyboard then gets no keymap before its first
# modifiers, and the engine crashes in `xkb_state_update_mask`. So the guard
# starts a keyboard that outlives the engine, after the last press and before
# the engine launches.
ENGINE_AT="$(grep -nF 'env "$(compositor_env)" "$CHROMIUM/$OUT/chrome"' "$GUARD" | head -1 | cut -d: -f1)"
LAST_PRESS="$(awk -v end="$ENGINE_AT" 'NR < end && /^[[:space:]]*press / { n = NR } END { print n }' "$GUARD")"
HOLD_AFTER="$(awk -v from="$LAST_PRESS" -v end="$ENGINE_AT" \
  'NR > from && NR < end && /-k Shift_L -s "\$KEYBOARD_LIVES_FOR_MS"/ { print NR; exit }' "$GUARD")"
[ -n "$ENGINE_AT" ] && [ -n "$LAST_PRESS" ] || {
  echo "no engine start or no press before it in $GUARD — they moved. Fix this test with it." >&2
  exit 1
}
expect "a held keyboard comes after the last press and before the engine" "yes" \
  "$([ -n "$HOLD_AFTER" ] && echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the chord guard's verdict names the right side in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
