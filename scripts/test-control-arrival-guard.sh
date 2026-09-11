#!/usr/bin/env bash
# Which layer the arrival guard blames, and which readings it calls a pass.
#
# The unit is the verdict block in `guard-control-arrival.sh` — the `if` chain
# that turns seven readings into either a pass or one sentence naming an end.
# The readings are not independent, so the chain is ordered, and an ordered
# chain is a thing that can be got wrong in a way no failing engine would ever
# reveal: the wrong arm answers, with a true-sounding sentence about the wrong
# layer, and the next person spends a CI cycle on it. That cycle is a Chromium
# build.
#
# It matters most for the two orderings a chain written top-to-bottom gets
# backwards:
#
#   a cursor the engine does not know reaching the page outranks a cursor it
#     does NOT reaching it. Both can be true at once — that is a codec wired
#     backwards — and "nothing reached the page" would then be a false
#     sentence about a run where something did
#   the cursor sent AFTER the unknown one is what separates "the bad name was
#     refused" from "the channel died on it". Its absence is not the same
#     finding as the unknown name's absence, and reading them as one is how a
#     guard passes an engine that stopped working entirely
#
# The block is run out of the real script rather than copied, so a rewrite that
# moves it fails here loudly instead of leaving this passing against a version
# nobody ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-control-arrival.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the `fi` that closes the decision. Both ends are whole
# lines at column zero, and the range stops at the first such `fi` — which is
# the chain's, not the `if [ -n "$FAILURE" ]` that acts on it below.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

# And the readings the chain consumes, which are a separate unit with a separate
# way of being wrong. From `saw()` to the last assignment.
READINGS="$(awk '/^saw\(\) \{/,/^ORDERED=/' "$GUARD")"
[ -n "$READINGS" ] || {
  echo "no readings block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

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
mentions() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}

# A run's seven readings, in the order the guard takes them, defaulting to the
# run that passes. Named arguments would be seven `case` arms to save a comment.
verdict() { # listening grab pointr zoom-out finite positive ordered
  LISTENING="${1:-1}" KNOWN_FIRST="${2:-1}" UNKNOWN="${3:-0}" \
    KNOWN_AFTER="${4:-1}" FINITE="${5:-1}" POSITIVE="${6:-1}" \
    ORDERED="${7:-1}" \
    bash -c 'set -u
      LISTENING=$LISTENING KNOWN_FIRST=$KNOWN_FIRST UNKNOWN=$UNKNOWN
      KNOWN_AFTER=$KNOWN_AFTER FINITE=$FINITE POSITIVE=$POSITIVE
      ORDERED=$ORDERED
      '"$BLOCK"'
      printf "%s" "$FAILURE"'
}

# ---------------------------------------------------------------------------
# THE READINGS, OVER A RECORDED LOG.
#
# This half exists because the other half did not catch the bug that mattered.
# The verdict chain was driven with variables set by hand, so it was perfectly
# exercised while every pattern that produces those variables was broken: the
# first version anchored them on `$`, and a `GUARD` line does not end where its
# message does --
#
#   [...:INFO:CONSOLE:48] "GUARD app-cursor app=guard cursor=grab", source: ...
#
# -- so on a run where the engine did everything right, six of seven readings
# came back 0. The dangerous one was `pointr`: it read 0 because the pattern
# could not match, not because the cursor had been refused, so the guard could
# not have failed on the one thing it exists to check. Invented inputs cannot
# find that; a recorded line can.
#
# These lines are copied from run 34623505023 rather than written from memory,
# for the same reason: what is under test is agreement with what Chromium
# actually writes.
CONSOLE='[1656824:1656824:0911/102653.088606:INFO:CONSOLE:48] "GUARD %s", source: domicile://shell/guard-control-arrival.js (48)'

logged() { # every argument is one GUARD message
  local message
  for message in "$@"; do
    # shellcheck disable=SC2059
    printf "$CONSOLE\n" "$message"
  done
}

readings() { # reads a log on stdin, prints the seven readings
  local log out
  log="$(mktemp)"
  cat >"$log"
  out="$(ENGINE_LOG="$log" bash -c 'set -u
    '"$READINGS"'
    printf "listening=%s grab=%s zoom-out=%s pointr=%s finite=%s positive=%s ordered=%s" \
      "$LISTENING" "$KNOWN_FIRST" "$KNOWN_AFTER" "$UNKNOWN" "$FINITE" "$POSITIVE" "$ORDERED"')"
  rm -f "$log"
  printf '%s' "$out"
}

# The run that prompted all of this, as it was actually written. Every reading
# must be 1 except the cursor that must never arrive.
expect "a good run reads as a good run" \
  "listening=1 grab=1 zoom-out=1 pointr=0 finite=1 positive=1 ordered=1" \
  "$(logged \
      "clock now=153.500" \
      "listening" \
      "app-cursor app=guard cursor=grab" \
      "hop arrival=415.600 stamp=415.900 ms=0.300" \
      "hop-shape finite=true positive=true ordered=true" \
      "app-cursor app=guard cursor=zoom-out" \
      "hop arrival=915.800 stamp=916.000 ms=0.200" \
      "hop-shape finite=true positive=true ordered=true" | readings)"

# THE READING THAT COULD NOT FAIL. If the engine ever stops refusing an unknown
# cursor, this is the only thing that notices.
expect "a leaked cursor is seen" \
  "listening=1 grab=1 zoom-out=1 pointr=1 finite=1 positive=1 ordered=1" \
  "$(logged \
      "listening" \
      "app-cursor app=guard cursor=grab" \
      "app-cursor app=guard cursor=pointr" \
      "app-cursor app=guard cursor=zoom-out" \
      "hop-shape finite=true positive=true ordered=true" | readings)"

# AND WHY THE ANCHOR CANNOT SIMPLY BE DROPPED. `grab` is a prefix of
# `grabbing`, which is a different cursor; an unanchored match would let one
# shape answer for the other and report a run that never saw `grab` as one that
# did.
expect "grabbing is not grab" \
  "listening=1 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0" \
  "$(logged "listening" "app-cursor app=guard cursor=grabbing" | readings)"

# The engine's own warning about the refused cursor lands in this same log and
# is not a console line. A reading that matched it would report the refusal as
# the failure the refusal prevents.
expect "the engine's own warning is not a cursor arriving" \
  "listening=1 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0" \
  "$( { logged "listening"
        echo "[1656824:1656854:0911/102653.593925:WARNING:components/domicile/browser/control_channel.cc:492] domicile: the compositor asked for a cursor named 'pointr', which is not one of the shapes this engine knows; the request was dropped."
      } | readings)"

# A stamp nobody filled in, once `undefined - n` has been through `toFixed`.
expect "an unfilled stamp reads false on all three" \
  "listening=1 grab=1 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0" \
  "$(logged \
      "listening" \
      "app-cursor app=guard cursor=grab" \
      "hop arrival=NaN stamp=415.900 ms=NaN" \
      "hop-shape finite=false positive=false ordered=false" | readings)"

# A log with nothing in it reads as nothing, rather than as anything.
expect "an empty log reads as no readings" \
  "listening=0 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0" \
  "$(printf '' | readings)"

expect "a run where everything arrived is a pass" "" "$(verdict)"

mentions "a module that never ran is named as the harness, not a finding" \
  "never registered a listener" "$(verdict 0 0 0 0 0 0 0)"

mentions "a known cursor that never arrived blames the path, not the page" \
  "never reached the page" "$(verdict 1 0 0 1)"

mentions "an unknown cursor that arrived is the closed set failing" \
  "closed set" "$(verdict 1 1 1 1)"

# THE ORDERING. A codec wired backwards passes the bad name and drops the good
# one, so both readings are bad at once — and only one of the two sentences is
# true about that run.
mentions "a codec wired backwards is reported as the bad name getting through" \
  "does not know reached the page" "$(verdict 1 0 1 1)"

# AND THE READING THAT MAKES THE ABSENCE MEAN ANYTHING. Without the cursor sent
# after the unknown one, a channel that died on the unknown one looks exactly
# like one that refused it.
mentions "a channel that stopped on the unknown name is not a refusal" \
  "not refused but fatal" "$(verdict 1 1 0 0)"

mentions "an arrival that is not a number is named as arithmetic on undefined" \
  "not a finite number" "$(verdict 1 1 0 1 0 0 0)"

mentions "a zero arrival is named as the stamp nothing wrote into" \
  "is zero" "$(verdict 1 1 0 1 1 0 0)"

mentions "an arrival after its own dispatch is two clocks, not a duration" \
  "not the same clock" "$(verdict 1 1 0 1 1 1 0)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
