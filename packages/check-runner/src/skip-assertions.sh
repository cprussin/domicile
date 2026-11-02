# Asserts that a library which decides whether a check can run says so: it
# exits 77 with a `SKIP:` reason when a prerequisite is missing, and does not
# skip when it is there.
#
# Exit 1 there fails a run on a laptop, and exit 0 reports a pass that measured
# nothing. Sourced by each library's test, which sets `ROOT` and `WORK` first
# and ends with `skip_assertions_end`.
#
# The libraries are sourced directly, so a test covers their behavior and not a
# caller's wiring.

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# Sources a library in its own `bash -c` and runs a line, printing the output.
# The libraries call `exit`, so each runs in a separate process.
drive() { # library, line to run after sourcing
  drive_in "$ROOT" "$@"
}

# Like `drive`, with a custom ROOT. ROOT must be set before sourcing, because
# a library may compute paths from it at that point.
drive_in() { # root, library, line to run after sourcing
  bash -c "set -u; ROOT='$1'; . '$2'; $3" 2>&1
}
drive_status() { # library, line to run after sourcing
  drive "$1" "$2" >/dev/null 2>&1
  echo $?
}

says_it_skipped() { # what, output
  case "$2" in
    (*SKIP:*) return 0 ;;
    (*) fail "$1" "it did not print a SKIP: line, so check-runner has no words for why: $2" ;;
  esac
  return 1
}

expect_skip() { # what, library, line
  local status output
  status="$(drive_status "$2" "$3")"
  output="$(drive "$2" "$3")"
  if [ "$status" -ne 77 ]; then
    fail "$1" "it exited $status rather than 77, so check-runner reads it as $(
      [ "$status" -eq 0 ] && echo 'a pass it never measured' || echo 'a failure of the code'
    )"
    return
  fi
  says_it_skipped "$1" "$output" && ok "$1"
}

# Exits with the test's verdict.
skip_assertions_end() {
  if [ "$FAILED" -gt 0 ]; then
    echo "$FAILED failed"
    exit 1
  fi
  echo "all ok"
}
