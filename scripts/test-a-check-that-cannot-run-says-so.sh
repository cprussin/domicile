#!/usr/bin/env bash
# Tests the libraries that decide whether a check can run: `engine-guard.sh`,
# `nix-check.sh` and `rust-check.sh`.
#
# `check.sh` reads exit 77 as "did not run" and other non-zero statuses as
# failures. A missing prerequisite (nix, a built Chromium tree, a linkable
# libxkbcommon) must exit 77: exit 1 makes `check.sh` fail on a laptop, and
# exit 0 reports a pass that measured nothing.
#
# The libraries are sourced directly, so the test covers their behavior and
# not a caller's wiring.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_LIB="$ROOT/scripts/lib/engine-guard.sh"
NIX_LIB="$ROOT/scripts/lib/nix-check.sh"
RUST_LIB="$ROOT/scripts/lib/rust-check.sh"
[ -f "$ENGINE_LIB" ] || { echo "no $ENGINE_LIB" >&2; exit 1; }
[ -f "$NIX_LIB" ] || { echo "no $NIX_LIB" >&2; exit 1; }
[ -f "$RUST_LIB" ] || { echo "no $RUST_LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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
# the library computes `ENGINE_SCRIPTS` from it at that point.
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
    (*) fail "$1" "it did not print a SKIP: line, so check.sh has no words for why: $2" ;;
  esac
  return 1
}

expect_skip() { # what, library, line
  local status output
  status="$(drive_status "$2" "$3")"
  output="$(drive "$2" "$3")"
  if [ "$status" -ne 77 ]; then
    fail "$1" "it exited $status rather than 77, so check.sh reads it as $(
      [ "$status" -eq 0 ] && echo 'a pass it never measured' || echo 'a failure of the code'
    )"
    return
  fi
  says_it_skipped "$1" "$output" && ok "$1"
}

echo "an engine check with no warm tree"

# A tree with no build, as in a fresh checkout. A bare `[ -d ]` would pass it.
mkdir -p "$WORK/empty-tree"
expect_skip "an unbuilt tree is a skip, not a pass" \
  "$ENGINE_LIB" "DOMICILE_CHROMIUM='$WORK/empty-tree' require_engine_out"

expect_skip "a tree that is not there is a skip, not a pass" \
  "$ENGINE_LIB" "DOMICILE_CHROMIUM='$WORK/no-such-tree' require_engine_out"

# A built tree must not skip; otherwise a library that always skips would pass
# the cases above.
mkdir -p "$WORK/built-tree/out/Domicile"
status="$(drive_status "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/built-tree' require_engine_out")"
if [ "$status" -eq 0 ]; then
  ok "a built tree is not a skip"
else
  fail "a built tree is not a skip" \
    "it exited $status with a build in place, so the guards would never run"
fi

# The out directory varies by caller: `engine.yml` uses `out/Domicile`,
# `engine-release.yml` uses `out/Release-staged`, and `pinned-engine.yml` uses a
# store path that is itself an out directory.
out="$(drive "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/built-tree' require_engine_out && printf '%s' \"\$ENGINE_OUT\"")"
if [ "$out" = "$WORK/built-tree/out/Domicile" ]; then
  ok "it resolves the tree's own build by default"
else
  fail "it resolves the tree's own build by default" \
    "ENGINE_OUT came out as '$out'"
fi

mkdir -p "$WORK/built-tree/out/Release-staged"
out="$(drive "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/built-tree' DOMICILE_ENGINE_OUT=out/Release-staged require_engine_out && printf '%s' \"\$ENGINE_OUT\"")"
if [ "$out" = "$WORK/built-tree/out/Release-staged" ]; then
  ok "it can be pointed at another out directory"
else
  fail "it can be pointed at another out directory" \
    "ENGINE_OUT came out as '$out'"
fi

# `.` is used by `pinned-engine.yml`, whose `nix build .#engine` store path is
# the out directory itself.
mkdir -p "$WORK/store-engine"
touch "$WORK/store-engine/chrome"
out="$(drive "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/store-engine' DOMICILE_ENGINE_OUT=. require_engine_out && printf '%s' \"\$ENGINE_OUT\"")"
if [ "$out" = "$WORK/store-engine/." ]; then
  ok "the engine directory can be the out directory itself"
else
  fail "the engine directory can be the out directory itself" \
    "ENGINE_OUT came out as '$out'"
fi

# A missing named out directory (e.g. a typo in `engine-release.yml`) skips.
expect_skip "a named out directory that is missing is a skip" \
  "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/built-tree' DOMICILE_ENGINE_OUT=no-such-build require_engine_out"

# --- the guard receives the resolved build -----------------------------------

# Guards read `OUT`, not `ENGINE_OUT`, and default to `out/Domicile`. Without
# `export OUT`, every caller that names another out directory reads the wrong
# build. A stand-in guard prints the `OUT` it received.
echo "the guard is told which build to read"

STANDIN="$WORK/standin/packages/domicile-engine/scripts"
mkdir -p "$STANDIN"
cat >"$STANDIN/guard-says-what-it-got.sh" <<'GUARD'
#!/usr/bin/env bash
printf 'dir=%s out=%s negative=%s\n' "$1" "${OUT:-UNSET}" "${NEGATIVE:-unset}"
GUARD
chmod +x "$STANDIN/guard-says-what-it-got.sh"

# The library sources `lib-annotate.sh` from the guards' directory.
cp "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh" "$STANDIN/"

mkdir -p "$WORK/store-engine-2"
saw() { # DOMICILE_ENGINE_OUT value (empty for unset), engine dir
  local out_var="$1" dir="$2"
  drive_in "$WORK/standin" "$ENGINE_LIB" \
    "DOMICILE_CHROMIUM='$dir' ${out_var:+DOMICILE_ENGINE_OUT='$out_var'} require_engine_out && engine_guard guard-says-what-it-got.sh"
}

got="$(saw "" "$WORK/built-tree")"
if [ "$got" = "dir=$WORK/built-tree out=out/Domicile negative=unset" ]; then
  ok "by default the guard is told out/Domicile"
else
  fail "by default the guard is told out/Domicile" "the guard saw: $got"
fi

got="$(saw "out/Release-staged" "$WORK/built-tree")"
if [ "$got" = "dir=$WORK/built-tree out=out/Release-staged negative=unset" ]; then
  ok "a named out directory reaches the guard"
else
  fail "a named out directory reaches the guard" "the guard saw: $got"
fi

# `.` must arrive as `.`; the guard joins it to the engine directory.
touch "$WORK/store-engine-2/chrome"
got="$(saw "." "$WORK/store-engine-2")"
if [ "$got" = "dir=$WORK/store-engine-2 out=. negative=unset" ]; then
  ok "an engine that is its own out directory reaches the guard as ."
else
  fail "an engine that is its own out directory reaches the guard as ." \
    "the guard saw: $got"
fi

# --- the caller decides whether the control runs -----------------------------

# The control runs by default. `pinned-engine.yml` and `engine-release.yml` opt
# out with `DOMICILE_GUARD_CONTROL=0`, since `engine.yml` already runs each
# control. Defaulting on means a caller that forgets still gets the control.
# `scripts/test-the-workflows-delegate-their-checks.sh` checks `engine.yml`
# never opts out.
echo "whether the control runs"

# Exported as its own statement: a prefix assignment on a function call does
# not outlive the call, and `wants_control` reads it later.
ran_what() { # DOMICILE_GUARD_CONTROL value (empty for unset)
  drive_in "$WORK/standin" "$ENGINE_LIB" \
    "${1:+export DOMICILE_GUARD_CONTROL='$1';} DOMICILE_CHROMIUM='$WORK/built-tree' require_engine_out && engine_guard_and_control guard-says-what-it-got.sh" |
    tr '\n' ' ' | sed 's/ *$//'
}

BOTH="dir=$WORK/built-tree out=out/Domicile negative=unset dir=$WORK/built-tree out=out/Domicile negative=1"
ONLY="dir=$WORK/built-tree out=out/Domicile negative=unset"

got="$(ran_what "")"
if [ "$got" = "$BOTH" ]; then
  ok "by default a check runs its guard and then its control"
else
  fail "by default a check runs its guard and then its control" "it ran: $got"
fi

got="$(ran_what 0)"
if [ "$got" = "$ONLY" ]; then
  ok "a caller that does not want the control gets only the guard"
else
  fail "a caller that does not want the control gets only the guard" "it ran: $got"
fi

# Opting out must drop only the control, never the guard.
case "$got" in
  (*negative=1*)
    fail "opting out drops the control and not the guard" \
      "the control ran anyway: $got" ;;
  ('')
    fail "opting out drops the control and not the guard" \
      "nothing ran at all, so the check would pass having measured nothing" ;;
  (*) ok "opting out drops the control and not the guard" ;;
esac

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

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
