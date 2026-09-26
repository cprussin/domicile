#!/usr/bin/env bash
# Which side the chord guard says took the key, and what it refuses to call a
# measurement.
#
# The unit is three pieces of `guard-shortcuts-inhibitor-chord.sh`, each run out
# of the real script rather than copied, so a rewrite that moves one fails here
# loudly instead of leaving this passing against a version nobody ships:
#
#   the verdict block   the `if` chain that turns the run's readings and its
#                       mode into either a pass or one sentence naming an end
#   the readings        the greps that turn the page's console and the host's
#                       binding log into those readings
#   host_ipc_socket     which sway the binding is installed in
#   engine_check        whether the engine is still running, and how it ended
#
# THE VACUITY THIS GUARD IS BUILT AGAINST is an absence read as an answer. Both
# of its claims are one side NOT taking a key, and "sway did not take it" reads
# exactly the same as a binding that was never installed, a keyboard that never
# came up, or a key that went nowhere at all; "the page did not get it" reads
# the same as a page that never listened or never had the keyboard. So every
# reading an absence rests on has a gate above it that proved the observer
# could see, and the order of those gates is what this spends its cases on.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shortcuts-inhibitor-chord.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, so this cannot half-match: the nested `fi`s in the two
# modes' arms are indented, and the block stops before the
# `if [ -n "$PASSED" ]` below it.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

# A function of the guard's, from its first line to its closing brace.
function_in_guard() { # name
  awk "/^$1\\(\\) \\{/,/^\\}/" "$GUARD"
}

# The readings, from the first to the host's, which is the last one taken — and
# the two functions they are taken with, which the guard's waits use too and so
# are defined above them.
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

# The keys, as the guard names them: the readings are about these two and no
# others, and the verdict names the chord they make.
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
# THE VERDICT.

# A run in which everything the positive run wants is true; each case below
# changes one reading. A baseline plus overrides, because `HOST_TOOK=1` says
# what a case is testing and nine positional arguments do not.
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

# The control's own baseline: the host took the chord and the page did not.
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

# The sentence, for the cases where WHICH end it names is the point. Not the
# whole wording: sentences are prose and will be reworded.
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
# THE FIRST RUN ON crux. The engine segfaulted just after the page's listener
# attached, and every reading after that was a dead page's silence — which the
# gates below read as a cause: "the host never gave the window the keyboard".
# So a dead engine is the verdict, ahead of every gate it could be misread as,
# and it names no other cause.
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
# THE CONTROL'S CHEAPEST PASS, once more: a dead page takes no key, and the
# host then takes the chord, which is exactly what the control wants to see.
expect "an engine that died is a failure in the control too" "fail" \
  "$(verdict 1 "${CRASH[@]}" "${CRUX[@]}")"
# Ahead of everything: a crash is the build's, whatever else the run lacked.
expect "a crash outranks a keyboard that never came up" "yes" \
  "$(names "crashed" 0 KEYBOARD_UP=0 "${CRASH[@]}" "${CRUX[@]}")"
# And of a pass: an engine that took the chord and then died still died.
expect "a crash outranks a pass" "fail" "$(verdict 0 "${CRASH[@]}")"
# How far the page got is read off what it said before it died.
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
# THE CONTROL'S CHEAPEST PASS. With no keyboard nothing is pressed, and "the page
# did not get it" is then true of every page there is.
expect "no virtual keyboard is a failure in the control too" "fail" \
  "$(verdict 1 KEYBOARD_UP=0 "${CONTROL[@]}")"

echo
echo "the host's side cannot see"
# THE POSITIVE RUN'S CHEAPEST PASS. With no binding, or one that does not fire
# for this keyboard, sway takes nothing whatever the inhibitor does — so "the
# host did not take it" is a statement about the binding and not about the
# inhibitor.
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
# AND THE CONTROL'S, from the other end: a page that never listened, never had
# the keyboard, or was never reached by a key at all did not get the chord for
# a reason that has nothing to do with the switch.
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
# A document can say it has focus a moment before the key it proves arrives, or
# after; the key arriving is what decides, and it outranks the focus reading.
expect "a plain key that arrived is focus enough" "pass" \
  "$(verdict 0 FOCUSED=0)"

echo
echo "the chord went nowhere, or everywhere"
# THE ONE THE TASK IS NAMED FOR. Both observers could see, and neither saw the
# chord: in the positive run that is NOT "the host did not take it", and in the
# control it is not "the page did not get it".
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
# NOT A FAILURE, AND IT MUST SAY SO. Which side took the key is decided whatever
# modifiers the page read — but a key without Meta is not a chord a shell
# matching Meta can use, and a pass that did not say so would claim more than
# the run saw.
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
# THE READINGS, OVER THE LINES THE ENGINE WRITES.
#
# The verdict above takes its readings on trust, and a reading that cannot match
# is a zero in the same voice as a key that never arrived. So they are run here
# over a log shaped the way Chromium writes a console line: the message inside
# quotes, with a prefix and a source after it. The format is the one recorded
# from run 34623505023 in `scripts/test-control-arrival-guard.sh`.
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
# The plain key is pressed before the chord and names a different key, so the
# page's reading of the chord cannot be satisfied by the key that proved the
# page could hear.
expect "the plain key is not the chord" \
  "listening=1 focused=1 plain=1 page=0 meta=0 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" |
       taken 1 1)"
expect "the chord's key without Meta is the page taking it, without Meta" \
  "listening=1 focused=1 plain=1 page=1 meta=0 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" \
       "keydown key=$CHORD_KEY meta=false" | taken 1 1)"
# THE QUOTE IS LOAD-BEARING, the way `guard-control-arrival.sh` found out: a key
# whose name starts with the chord's is a different key, and an unanchored match
# would let it answer for the chord.
expect "a key named after the chord's is not the chord" \
  "listening=1 focused=1 plain=1 page=0 meta=0 host=0" \
  "$(logged "listening" "focused" "keydown key=$PLAIN_KEY meta=false" \
       "keydown key=${CHORD_KEY}en meta=true" | taken 1 1)"
# The calibration press is the binding's first line and is not the chord.
expect "the calibration press is not the host taking the chord" \
  "listening=0 focused=0 plain=0 page=0 meta=0 host=0" \
  "$(printf '' | taken 1 1)"

# ---------------------------------------------------------------------------
# WHETHER THE ENGINE IS STILL THERE. The verdict above takes the engine's end on
# trust; this is the piece that finds it, over stand-ins that end the ways an
# engine can. The first place it is found dead is the one that counts: a later
# check must not move it.
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
# WHICH SWAY. `under-wayland.sh` starts sway with no `SWAYSOCK` exported, so
# the guard finds the socket sway made in `XDG_RUNTIME_DIR` — and a socket left
# by a sway that was killed outright is still there, so a live pid is what
# makes one a candidate. More than one live candidate is a question the guard
# cannot answer, and it must say so rather than pick one.
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

# crux's shape: the browser's own lines, crashpad's pid-less ones, then a
# signal and a stack longer than any tail short enough to read, with a child's
# TLS noise over the end of it. The frame that names the handler is #0.
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

# No stack at all — crashpad took the signal and could not read the process —
# is still the browser's own last lines.
printf '[100:100:0926/011843.4:INFO:CONSOLE:32] "GUARD listening"\n' >"$DEATH_LOG"
expect "with no stack, the browser's own last line is printed" "yes" \
  "$(engine_last_words 100 "$DEATH_LOG" | grep -qF 'GUARD listening' && echo yes || echo no)"
rm -f "$DEATH_LOG"

echo "what the seat holds when the engine binds its keyboard"

# A `press` is a wtype of its own, and when it exits sway's seat has no active
# keyboard: a client binding the keyboard then gets no keymap before its first
# modifiers, and the engine segfaulted on exactly that in
# `xkb_state_update_mask` (crux run 36232746099). So the seat is held again,
# by a keyboard that outlives the engine, after the last press before it.
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
