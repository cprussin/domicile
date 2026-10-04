#!/usr/bin/env bash
# Tests the readings and the verdict chain in `guard-control-arrival.sh`.
#
# The chain is ordered, and a wrong order blames the wrong layer. Two orderings
# matter most:
#
# - An unknown cursor reaching the page outranks a known cursor missing it.
#   Both happen when the codec is wired backward.
# - The cursor sent after the unknown one separates "refused" from "the channel
#   died". Without it, a dead engine passes.
#
# Both blocks run out of the real script, so moving them fails this test.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-control-arrival.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

# From `FAILURE=""` to the first column-zero `fi`, which closes the chain.
BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

# The readings the chain consumes: from `saw()` to the last assignment.
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

# Prints the verdict for seven readings, given in the guard's order. Each
# defaults to the passing value.
verdict() { # listening grab pointr zoom-out finite positive ordered names
  LISTENING="${1:-1}" KNOWN_FIRST="${2:-1}" UNKNOWN="${3:-0}" \
    KNOWN_AFTER="${4:-1}" FINITE="${5:-1}" POSITIVE="${6:-1}" \
    ORDERED="${7:-1}" NAMES="${8:-1}" \
    bash -c 'set -u
      LISTENING=$LISTENING KNOWN_FIRST=$KNOWN_FIRST UNKNOWN=$UNKNOWN
      KNOWN_AFTER=$KNOWN_AFTER FINITE=$FINITE POSITIVE=$POSITIVE
      ORDERED=$ORDERED NAMES=$NAMES
      '"$BLOCK"'
      printf "%s" "$FAILURE"'
}

# ---------------------------------------------------------------------------
# Readings, over recorded log lines.
#
# Hand-set variables cannot catch a pattern that fails to match. A `GUARD` line
# does not end where its message does:
#
#   [...:INFO:CONSOLE:48] "GUARD app-cursor app=guard cursor=grab", source: ...
#
# The template is copied from run 34623505023 so the patterns are tested
# against what Chromium writes.
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
    printf "listening=%s grab=%s zoom-out=%s pointr=%s finite=%s positive=%s ordered=%s names=%s" \
      "$LISTENING" "$KNOWN_FIRST" "$KNOWN_AFTER" "$UNKNOWN" "$FINITE" "$POSITIVE" "$ORDERED" "$NAMES"')"
  rm -f "$log"
  printf '%s' "$out"
}

# A passing run: every reading is 1 except the cursor that must not arrive.
expect "a good run reads as a good run" \
  "listening=1 grab=1 zoom-out=1 pointr=0 finite=1 positive=1 ordered=1 names=1" \
  "$(logged \
      "names missing=none" \
      "clock now=153.500" \
      "listening" \
      "app-cursor app=guard cursor=grab" \
      "hop arrival=415.600 stamp=415.900 ms=0.300" \
      "hop-shape finite=true positive=true ordered=true" \
      "app-cursor app=guard cursor=zoom-out" \
      "hop arrival=915.800 stamp=916.000 ms=0.200" \
      "hop-shape finite=true positive=true ordered=true" | readings)"

# This is the only check that notices the engine accepting an unknown cursor.
expect "a leaked cursor is seen" \
  "listening=1 grab=1 zoom-out=1 pointr=1 finite=1 positive=1 ordered=1 names=0" \
  "$(logged \
      "listening" \
      "app-cursor app=guard cursor=grab" \
      "app-cursor app=guard cursor=pointr" \
      "app-cursor app=guard cursor=zoom-out" \
      "hop-shape finite=true positive=true ordered=true" | readings)"

# `grab` is a prefix of `grabbing`, so the match must be anchored.
expect "grabbing is not grab" \
  "listening=1 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0 names=0" \
  "$(logged "listening" "app-cursor app=guard cursor=grabbing" | readings)"

# The engine's warning about the refused cursor is in the same log and must not
# count as the cursor arriving.
expect "the engine's own warning is not a cursor arriving" \
  "listening=1 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0 names=0" \
  "$( { logged "listening"
        echo "[1656824:1656854:0911/102653.593925:WARNING:components/domicile/browser/control_channel.cc:492] domicile: the compositor asked for a cursor named 'pointr', which is not one of the shapes this engine knows; the request was dropped."
      } | readings)"

# A stamp nobody filled in, once `undefined - n` has been through `toFixed`.
expect "an unfilled stamp reads false on all three" \
  "listening=1 grab=1 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0 names=0" \
  "$(logged \
      "listening" \
      "app-cursor app=guard cursor=grab" \
      "hop arrival=NaN stamp=415.900 ms=NaN" \
      "hop-shape finite=false positive=false ordered=false" | readings)"

expect "an empty log reads as no readings" \
  "listening=0 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0 names=0" \
  "$(printf '' | readings)"

# The fork keeps navigator.domicile's event names in domicile_event_names.h.
# The page fires each at its listener and its on<name> handler; a lost name is
# a message the shell never receives.
expect "a name that did not fire is read as missing" \
  "listening=1 grab=0 zoom-out=0 pointr=0 finite=0 positive=0 ordered=0 names=0" \
  "$(logged "names missing=ontheme" "listening" | readings)"

mentions "a name that did not fire is blamed on the fork's names" \
  "domicile_event_names.h" "$(verdict 1 1 0 1 1 1 1 0)"

mentions "and outranks the cursor readings, which it can take down with it" \
  "domicile_event_names.h" "$(verdict 1 0 0 0 0 0 0 0)"

expect "a run where everything arrived is a pass" "" "$(verdict)"

mentions "a module that never ran is named as the harness, not a finding" \
  "never registered a listener" "$(verdict 0 0 0 0 0 0 0 0)"

mentions "a known cursor that never arrived blames the path, not the page" \
  "never reached the page" "$(verdict 1 0 0 1)"

mentions "an unknown cursor that arrived is the closed set failing" \
  "closed set" "$(verdict 1 1 1 1)"

# A codec wired backward passes the bad name and drops the good one. Only the
# bad name getting through is the true report.
mentions "a codec wired backward is reported as the bad name getting through" \
  "does not know reached the page" "$(verdict 1 0 1 1)"

# Without the cursor sent after the unknown one, a channel that died looks like
# one that refused it.
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
