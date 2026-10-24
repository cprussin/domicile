# Runs checks and reports each as passed, failed or skipped.
#
# Sourced by `bin/check-runner.sh` and by runners that order their own checks
# (`scripts/check.sh`). Call `report_start`, then `run` for each check, then
# `report_end`, which exits with the run's verdict.
#
# A check exits 0 to pass, 77 to say it could not run (automake's convention),
# and anything else to fail. A skip prints `SKIP: <reason>`.
#
# - `DOMICILE_CHECK_STRICT=1` turns a skip into a failure, for CI.
# - `DOMICILE_CHECK_ALLOW_SKIP` names checks, space separated, that may skip
#   under `STRICT`.
# - `DOMICILE_CHECK_LOG_DIR` is where a failing check's whole log is kept,
#   under `domicile-check-logs/`. Defaults to `$TMPDIR`.

# The exit status a check uses to say it could not run.
readonly SKIPPED_STATUS=77

# Sets up the tallies and the failure summary.
report_start() {
  PASSED=(); FAILED=(); SKIPPED=()
  STRICT="${DOMICILE_CHECK_STRICT:-0}"
  EXPECTED_SKIPS="${DOMICILE_CHECK_ALLOW_SKIP:-}"
  FAILURES="$(mktemp)"
  # Not cleaned up, so it outlives the run. Several runners can share it, so
  # each removes only its own checks' logs.
  KEEP_LOGS="${DOMICILE_CHECK_LOG_DIR:-${TMPDIR:-/tmp}}/domicile-check-logs"
  mkdir -p "$KEEP_LOGS"
}

# Runs one check. Its output goes to a file, shown only when it fails. A
# passing check's `PASS:` lines are printed under its `ok`, so a pass says what
# it established.
run() { # name, command...
  local name="$1"; shift
  local log; log="$(mktemp)"
  rm -f "$KEEP_LOGS/$name.log"
  label "$name"
  "$@" >"$log" 2>&1
  verdict "$name" "$?" "$log"
}

# Prints the verdict of a check whose name `label` already printed, and
# removes its log.
verdict() { # name, status, log
  local name="$1" status="$2" log="$3" reason
  if [ "$status" -eq 0 ]; then
    echo "ok"
    sed -n 's/^ *PASS: /    PASS: /p' "$log"
    PASSED+=("$name")
  elif [ "$status" -eq "$SKIPPED_STATUS" ]; then
    reason="$(sed -n 's/^ *SKIP: *//p' "$log" | head -1)"
    if [ -n "$reason" ]; then
      skip "$name" "$reason"
    else
      # A skip that does not say why cannot be told from a broken check.
      failed "$name" "skipped without a SKIP: reason" "$log"
    fi
  else
    echo "FAILED"
    FAILED+=("$name")
    keep_log "$name" "$log"
  fi
  rm -f "$log"
}

# Prints a skip's verdict, or fails it under `STRICT` unless it is expected.
skip() { # name, reason
  case " $EXPECTED_SKIPS " in
    *" $1 "*)
      printf 'skipped, as expected here (%s)\n' "$2"
      SKIPPED+=("$1 — expected: $2")
      return
      ;;
  esac
  if [ "$STRICT" = "1" ]; then
    printf 'FAILED (%s)\n' "$2"
    FAILED+=("$1 — could not run: $2")
    echo "--- $1 ---" >>"$FAILURES"
    echo "could not run: $2" >>"$FAILURES"
    echo >>"$FAILURES"
  else
    printf 'skipped (%s)\n' "$2"
    SKIPPED+=("$1 — $2")
  fi
}

# Fails a check for a reason the runner found, keeping its log.
failed() { # name, reason, log
  printf 'FAILED (%s)\n' "$2"
  FAILED+=("$1 — $2")
  keep_log "$1" "$3"
}

# Adds a failed check's report to the summary and keeps its whole log.
keep_log() { # name, log
  echo "--- $1 ---" >>"$FAILURES"
  # A failing test's report from `cargo test`, which later test binaries can
  # push above the tail.
  sed -n '/^---- .* stdout ----$/,/^test result: /p' "$2" >>"$FAILURES"
  tail -100 "$2" >>"$FAILURES"
  # Keeps the whole log too: a failure's key line can sit above the tail.
  cp "$2" "$KEEP_LOGS/$1.log"
  echo "  (the whole log: $KEEP_LOGS/$1.log)" >>"$FAILURES"
  echo >>"$FAILURES"
}

# Prints the name and leaves the line open for the verdict, so a long check
# shows what is running.
label() { # name
  printf '  %-24s ' "$1"
}

# Prints what failed and the tally, then exits 1 if anything failed or nothing
# ran.
report_end() {
  echo
  if [ "${#FAILED[@]}" -gt 0 ]; then
    echo "== what failed =="
    cat "$FAILURES"
  fi
  rm -f "$FAILURES"
  echo "== ${#PASSED[@]} passed, ${#FAILED[@]} failed, ${#SKIPPED[@]} skipped =="
  if [ $(( ${#PASSED[@]} + ${#FAILED[@]} + ${#SKIPPED[@]} )) -eq 0 ]; then
    echo "  and that is a failure: nothing ran."
    exit 1
  fi
  local one
  for one in "${SKIPPED[@]:-}"; do [ -n "$one" ] && echo "  skipped: $one"; done
  for one in "${FAILED[@]:-}"; do [ -n "$one" ] && echo "  failed:  $one"; done
  [ "${#FAILED[@]}" -eq 0 ] || exit 1
  exit 0
}
