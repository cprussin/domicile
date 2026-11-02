#!/usr/bin/env bash
# Tests that `lib/nix-check.sh` skips a nix check on a machine without nix.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
NIX_LIB="$ROOT/packages/distro-checks/lib/nix-check.sh"
[ -f "$NIX_LIB" ] || { echo "no $NIX_LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=packages/check-runner/src/skip-assertions.sh
. "$ROOT/packages/check-runner/src/skip-assertions.sh"

echo "a nix check with no nix"

# An empty PATH, so nix cannot be found wherever it is installed.
expect_skip "no nix is a skip, not a failure of the code" \
  "$NIX_LIB" "PATH='$WORK/nowhere' require_nix"

# A stub `nix` on PATH must not skip. A stub keeps this test runnable on CI
# machines without nix, where strict mode forbids a skip.
STUB="$WORK/stub-bin"
mkdir -p "$STUB"
printf '#!/bin/sh\nexit 0\n' >"$STUB/nix"
chmod +x "$STUB/nix"

status="$(drive_status "$NIX_LIB" "PATH='$STUB' require_nix")"
if [ "$status" -eq 0 ]; then
  ok "nix on PATH is not a skip"
else
  fail "nix on PATH is not a skip" \
    "it exited $status with nix on PATH, so the nix group would never run"
fi

skip_assertions_end
