#!/usr/bin/env bash
# How `run-engine.sh` finds its compositor and its bridge.
#
# The unit is the pair of blocks that turn `DOMICILE_COMPOSITOR` and
# `DOMICILE_BRIDGE` into paths. Each is a thing with two ways to have it: a
# checkout builds it, a package hands it in already built. Nothing here is a
# fallback — an unset variable means "build it", which is a different
# instruction rather than a recovery, and the two are not interchangeable.
#
# THIS IS THE HOLE THE NIX WORKFLOW LEAVES. `nix-build.yml` starts a packaged
# desktop with a compositor that cannot exist and reads the refusal, which
# covers the compositor and everything resolved before it. It cannot cover the
# bridge: the bridge is checked *after* the compositor, so that run has already
# exited by the time it would matter. Deleting `BRIDGE="${DOMICILE_BRIDGE:-}"`
# left every check in this repository green while every packaged desktop went
# looking for a workspace that is not in the store.
#
# Run out of the real script rather than copied, so a rewrite that moves it
# fails here loudly instead of leaving this passing against a version nobody
# ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT/scripts/run-engine.sh"

# Two pieces, because they are not adjacent in the script and the first is what
# makes this a test of the environment rather than of two local variables. The
# `sed` drops the line the second range ends on: `awk`'s ranges are inclusive
# and there is no marker between the bridge check and the socket cleanup that
# follows it.
INPUTS="$(awk '/^PAGE_DIR="\$\{DOMICILE_PAGE:-\}"$/,/^BRIDGE="\$\{DOMICILE_BRIDGE:-\}"$/' \
            "$SCRIPT_UNDER_TEST")"
RESOLVE="$(awk '/^if \[ -z "\$COMPOSITOR" \]; then$/,/^rm -f "\$BROKER"/' \
             "$SCRIPT_UNDER_TEST" | sed '$d')"
[ -n "$INPUTS" ] && [ -n "$RESOLVE" ] || {
  echo "no input resolution in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}
# Both halves, or this passes against one of them. `DOMICILE_BRIDGE` reaching
# `BRIDGE` is the whole subject: with only the second range, dropping the
# assignment in the first would go unnoticed here exactly as it does in CI.
case "$INPUTS" in
  (*DOMICILE_COMPOSITOR*DOMICILE_BRIDGE*) ;;
  (*) echo "the input block no longer names both variables." >&2; exit 1 ;;
esac

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

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A checkout that has already built both, which is the state the "build it"
# branch leaves behind. It exists in every case so that a run reaching for it
# when it was handed something else *succeeds* — a mutation that reads as a
# different path rather than as a refusal, which is the harder one to catch.
FAKE_ROOT="$WORK/checkout"
mkdir -p "$FAKE_ROOT/target/debug" "$FAKE_ROOT/packages/engine-chrome-host/src"
: >"$FAKE_ROOT/target/debug/domicile-compositor"
chmod +x "$FAKE_ROOT/target/debug/domicile-compositor"
: >"$FAKE_ROOT/packages/engine-chrome-host/src/main.ts"

# What a package hands in: a store path, built elsewhere, nothing to do with a
# checkout.
mkdir -p "$WORK/store"
: >"$WORK/store/domicile-compositor"
chmod +x "$WORK/store/domicile-compositor"
: >"$WORK/store/main.ts"
# `-f` and `-x` are two checks and each has something the other lets through:
# a file with the wrong mode passes the first, and a *directory* passes the
# second — every directory is executable. The second is the likelier mistake by
# far, because a store path is a directory and `DOMICILE_COMPOSITOR` wants the
# binary inside it.
: >"$WORK/store/unrunnable-compositor"
chmod -x "$WORK/store/unrunnable-compositor"
mkdir -p "$WORK/store/compositor-package/bin"

# `cargo` as a function, which wins over anything on `PATH`, so the "build it"
# branch is exercised without building anything. `CARGO_FAILS` is the other
# half of `|| exit 1`: a compositor that did not compile is not a compositor.
resolve() { # $1 DOMICILE_COMPOSITOR, $2 DOMICILE_BRIDGE, $3 (optional) fail cargo
  local out
  if out="$( (
      # `$3` inside the function is `cargo`'s own third word, not this
      # helper's, so the flag is read out here where it still means what the
      # caller wrote. Read the other way round, every build refused and the
      # case named for refusing passed without exercising anything.
      CARGO_FAILS="${3:-}"
      cargo() { echo "cargo $*" >>"$WORK/cargo.log"; [ -z "$CARGO_FAILS" ]; }
      ROOT="$FAKE_ROOT"
      PAGE_DIR=""
      DOMICILE_PAGE=""
      DOMICILE_COMPOSITOR="$1"
      DOMICILE_BRIDGE="$2"
      eval "$INPUTS"
      eval "$RESOLVE"
      echo "compositor=$COMPOSITOR bridge=$BRIDGE"
    ) 2>&1 )"; then
    echo "$out"
  else
    # The sentence, not just the status. `nix-build.yml` greps "no compositor
    # at <path>" by exact text to prove a packaged desktop resolves its inputs
    # out of the store, so a reworded refusal breaks a check three files away
    # and says nothing about why. It fails here instead.
    # Bare `refused` when it said nothing, which is a real answer rather than
    # a missing one: a compositor that did not compile is refused by `cargo`'s
    # own output and this script has nothing to add to it.
    local said
    said="$(printf '%s\n' "$out" | head -1)"
    printf 'refused%s\n' "${said:+: $said}"
  fi
}

# THE CASE A PACKAGE TAKES, for both. `nix run github:cprussin/domicile#simple`
# has all of this in the store already, and building either at startup would be
# both slower and a second way to produce something that exists.
expect "a handed-in compositor is used as it is" \
  "compositor=$WORK/store/domicile-compositor bridge=$WORK/store/main.ts" \
  "$(resolve "$WORK/store/domicile-compositor" "$WORK/store/main.ts")"

# THE ONE CI CANNOT REACH. Same run as above; named on its own because the
# assertion that covers the compositor stops before the bridge, so this line is
# the only thing standing between a dropped `DOMICILE_BRIDGE` and every
# packaged desktop looking for a checkout that is not in the store.
expect "a handed-in bridge is used rather than the checkout's" \
  "compositor=$WORK/store/domicile-compositor bridge=$WORK/store/main.ts" \
  "$(resolve "$WORK/store/domicile-compositor" "$WORK/store/main.ts")"

# THE CASE A CHECKOUT TAKES. Neither variable set is a developer with this
# repository open, and the instruction is to build.
expect "nothing handed in builds the compositor and takes the workspace bridge" \
  "compositor=$FAKE_ROOT/target/debug/domicile-compositor bridge=$FAKE_ROOT/packages/engine-chrome-host/src/main.ts" \
  "$(resolve "" "")"

: >"$WORK/cargo.log"
resolve "$WORK/store/domicile-compositor" "$WORK/store/main.ts" >/dev/null
expect "a handed-in compositor is not built again" \
  "" \
  "$(cat "$WORK/cargo.log")"

: >"$WORK/cargo.log"
resolve "" "" >/dev/null
expect "a compositor that was not handed in is built" \
  "cargo build -p domicile-compositor" \
  "$(cat "$WORK/cargo.log")"

# The two are independent: a developer iterating on the compositor from a
# checkout still wants the packaged bridge, and the reverse.
expect "each is answered on its own" \
  "compositor=$FAKE_ROOT/target/debug/domicile-compositor bridge=$WORK/store/main.ts" \
  "$(resolve "" "$WORK/store/main.ts")"

expect "a compositor that is not there is refused" \
  "refused: no compositor at $WORK/store/no-such-compositor" \
  "$(resolve "$WORK/store/no-such-compositor" "$WORK/store/main.ts")"

expect "a compositor that cannot be run is refused" \
  "refused: no compositor at $WORK/store/unrunnable-compositor" \
  "$(resolve "$WORK/store/unrunnable-compositor" "$WORK/store/main.ts")"

expect "a directory named as the compositor is refused" \
  "refused: no compositor at $WORK/store/compositor-package" \
  "$(resolve "$WORK/store/compositor-package" "$WORK/store/main.ts")"

expect "a bridge that is not there is refused" \
  "refused: no bridge at $WORK/store/no-such-bridge" \
  "$(resolve "$WORK/store/domicile-compositor" "$WORK/store/no-such-bridge")"

# A compositor that did not compile is not a compositor, and the run that
# follows would be a browser waiting for a producer that is never coming.
expect "a compositor that does not build is refused" \
  "refused" \
  "$(resolve "" "" fail)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
