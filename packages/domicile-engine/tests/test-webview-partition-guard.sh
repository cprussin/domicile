#!/usr/bin/env bash
# Tests the verdict of `guard-webview-partition.sh`: which readings pass and
# which component a failure blames.
#
# The run keeps each partition's key apart; the control, with no partition,
# shares both keys everywhere. Runs the verdict block from the real guard, so
# moving it fails here.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-webview-partition.sh"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^fi$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
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

# A passing run of the given mode; each case changes one reading.
readings() { # $1 NEGATIVE, then NAME=value overrides
  NEGATIVE="$1"
  SAW_SHELL=1
  SAW_CRASH=0
  SAW_WROTE=1
  SAW_WINDOW=1
  SAW_RESTART=1
  if [ "$NEGATIVE" = "1" ]; then
    SAME_KEYS="memory,persisted"
    DEFAULT_KEYS="memory,persisted"
    MEMORY_KEYS="memory,persisted"
    WINDOW_PARTITION=""
    WINDOW_KEYS="memory,persisted"
    RESTARTED_KEYS="memory,persisted"
    RESTARTED_MEMORY_KEYS="memory,persisted"
  else
    SAME_KEYS="persisted"
    DEFAULT_KEYS="(none)"
    MEMORY_KEYS="memory"
    WINDOW_PARTITION="persist:guard"
    WINDOW_KEYS="persisted"
    RESTARTED_KEYS="persisted"
    RESTARTED_MEMORY_KEYS="(none)"
  fi
  shift
  for override in "$@"; do
    eval "$override"
  done
}

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

blames() { # $1 word, then the args verdict takes
  local word="$1"
  shift
  case "$(
    readings "$@"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$word"*) echo yes ;;
  *) echo no ;;
  esac
}

echo "a run that never got as far as measuring anything"
expect "no shell is a failure" "fail" "$(verdict 0 SAW_SHELL=0)"
expect "a crash is a failure" "fail" "$(verdict 0 SAW_CRASH=1)"
expect "a crash names patch 0115" "yes" "$(blames "0115" 0 SAW_CRASH=1)"
expect "no writer is a failure" "fail" "$(verdict 0 SAW_WROTE=0)"
expect "and names the refusal's log line" "yes" \
  "$(blames "named partition" 0 SAW_WROTE=0)"
expect "a reader that never read is a failure" "fail" \
  "$(verdict 0 DEFAULT_KEYS=)"

echo
echo "the run — keys in persist:guard and guard"
expect "each partition has only its key: pass" "pass" "$(verdict 0)"
expect "the writer's own side missing its key is a failure" "fail" \
  "$(verdict 0 'SAME_KEYS="(none)"')"
expect "the user's storage having a key is a failure" "fail" \
  "$(verdict 0 DEFAULT_KEYS=persisted)"
expect "and names ParamsFor" "yes" \
  "$(blames "ParamsFor" 0 DEFAULT_KEYS=persisted)"
expect "the two partitions being one is a failure" "fail" \
  "$(verdict 0 MEMORY_KEYS="memory,persisted")"
expect "an unlisted window is a failure" "fail" "$(verdict 0 SAW_WINDOW=0)"
expect "a window listed in no partition is a failure" "fail" \
  "$(verdict 0 WINDOW_PARTITION=)"
expect "and names WebViewGuest::partition" "yes" \
  "$(blames "WebViewGuest::partition" 0 WINDOW_PARTITION=)"
expect "a window outside its partition is a failure" "fail" \
  "$(verdict 0 'WINDOW_KEYS="(none)"')"
expect "and names BrowserWindowsService::Open" "yes" \
  "$(blames "BrowserWindowsService::Open" 0 'WINDOW_KEYS="(none)"')"
expect "no restart is a failure" "fail" "$(verdict 0 SAW_RESTART=0)"
expect "persist:guard lost on restart is a failure" "fail" \
  "$(verdict 0 'RESTARTED_KEYS="(none)"')"
expect "guard kept on restart is a failure" "fail" \
  "$(verdict 0 RESTARTED_MEMORY_KEYS=memory)"

echo
echo "the control — no partition anywhere"
expect "every reader has both keys: pass" "pass" "$(verdict 1)"
expect "a reader missing a key is a failure" "fail" \
  "$(verdict 1 DEFAULT_KEYS=persisted)"
expect "nothing outliving the restart is a failure" "fail" \
  "$(verdict 1 'RESTARTED_KEYS="(none)"')"
expect "a window listed in a partition is a failure" "fail" \
  "$(verdict 1 WINDOW_PARTITION=persist:guard)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the partition guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
