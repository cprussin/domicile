#!/usr/bin/env bash
# Tests that `lib/rust-check.sh` skips a Rust check on a machine that cannot
# link the workspace.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUST_LIB="$ROOT/packages/rust-checks/lib/rust-check.sh"
[ -f "$RUST_LIB" ] || { echo "no $RUST_LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=packages/check-runner/src/skip-assertions.sh
. "$ROOT/packages/check-runner/src/skip-assertions.sh"

echo "a rust check with nothing to link against"

# A stand-in `cc`, since the library asks the compiler whether
# `-lxkbcommon` links.
STANDIN_CC="$WORK/cc"
mkdir -p "$STANDIN_CC"
cc_that() { # exit status the stand-in compiler gives every invocation
  printf '#!/bin/sh\nexit %s\n' "$1" >"$STANDIN_CC/cc"
  chmod +x "$STANDIN_CC/cc"
}

cc_that 1
expect_skip "a cc that cannot resolve -lxkbcommon is a skip, not a failure of the code" \
  "$RUST_LIB" "PATH='$STANDIN_CC' require_linkable_libraries"

# The skip message must name the library and how to get it.
why="$(drive "$RUST_LIB" "PATH='$STANDIN_CC' require_linkable_libraries")"
case "$why" in
  (*xkbcommon*"nix develop"*) ok "it names the library and where to get one" ;;
  (*) fail "it names the library and where to get one" "the skip said: $why" ;;
esac

# With no `cc` at all, installing libxkbcommon would not help, so this has its
# own message.
expect_skip "no cc is a skip, not a failure of the code" \
  "$RUST_LIB" "PATH='$WORK/nowhere' require_linkable_libraries"

# A working `cc` must not skip; otherwise a library that always skips would
# pass the cases above.
cc_that 0
status="$(drive_status "$RUST_LIB" "PATH='$STANDIN_CC' require_linkable_libraries")"
if [ "$status" -eq 0 ]; then
  ok "a cc that links is not a skip"
else
  fail "a cc that links is not a skip" \
    "it exited $status where the library resolved, so cargo test would never run"
fi

skip_assertions_end
