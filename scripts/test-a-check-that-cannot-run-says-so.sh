#!/usr/bin/env bash
# The two libraries that decide whether a check can run here, driven directly.
#
# `check.sh` reads exit 77 as "did not run" and everything else non-zero as
# "failed", and under `DOMICILE_CHECK_STRICT=1` a skip is itself a failure that
# names which check stopped running. All of that depends on a check getting the
# status right when its prerequisite is missing, and the two prerequisites here
# are absent on most machines: `nix`, and a warm Chromium tree.
#
# Getting it wrong is expensive in both directions. Exit 1 without nix makes
# `./scripts/check.sh` unrunnable on a laptop, which is how a suite stops being
# run at all. Exit 0 without the tree is worse and is the failure this
# repository has shipped three times: a check that reported a pass having
# measured nothing. Before exit 77 existed, a green CI run named ten suites
# where nine had run.
#
# Driven as libraries rather than through a script that sources them, for the
# reason `packages/e2e-harness/src/verdicts.test.ts` drives `lib/harness.sh`
# directly: the behavior belongs to the library, and a test that reached it
# through one of its callers would be asserting that caller's wiring instead.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE_LIB="$ROOT/scripts/lib/engine-guard.sh"
NIX_LIB="$ROOT/scripts/lib/nix-check.sh"
[ -f "$ENGINE_LIB" ] || { echo "no $ENGINE_LIB" >&2; exit 1; }
[ -f "$NIX_LIB" ] || { echo "no $NIX_LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A library sourced in a shell of its own, so its `exit` is the status here and
# its output is a string to assert on. `bash -c` rather than a subshell: these
# libraries end in `exit`, and an `exit` inside `( ... )` in this script would
# leave the enclosing run without a verdict.
drive() { # library, line to run after sourcing
  drive_in "$ROOT" "$@"
}

# The same, with a ROOT of the caller's choosing. It has to be set BEFORE the
# library is sourced, because that is when `ENGINE_SCRIPTS` is computed from it
# -- a `ROOT=...` in the line that runs afterward is too late, which is how the
# stand-in cases below first reported the real guard directory instead.
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

# A directory that exists and holds no build, which is the shape a fresh
# checkout of the engine package has. Asserted separately from a path that does
# not exist at all, because "the tree is there and was never built" is the case
# a person actually hits and the one a bare `[ -d ]` would wave through.
mkdir -p "$WORK/empty-tree"
expect_skip "an unbuilt tree is a skip, not a pass" \
  "$ENGINE_LIB" "DOMICILE_CHROMIUM='$WORK/empty-tree' require_engine_out"

expect_skip "a tree that is not there is a skip, not a pass" \
  "$ENGINE_LIB" "DOMICILE_CHROMIUM='$WORK/no-such-tree' require_engine_out"

# And the positive: a directory laid out like a built tree must NOT skip, or
# every assertion above is satisfied by a library that skips unconditionally —
# which would be a guard suite that never runs and always passes.
mkdir -p "$WORK/built-tree/out/Domicile"
status="$(drive_status "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/built-tree' require_engine_out")"
if [ "$status" -eq 0 ]; then
  ok "a built tree is not a skip"
else
  fail "a built tree is not a skip" \
    "it exited $status with a build in place, so the guards would never run"
fi

# Where the guards are pointed, which is the whole reason this is a library and
# not a line in each script: `engine.yml` runs them against the warm tree's
# `out/Domicile`, `engine-release.yml` against a tarball unpacked into
# `out/Release-staged`, and `pinned-engine.yml` against a store path that is an
# out directory itself. A library that resolved only the first would send the
# other two at the wrong build and report on it.
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

# `.`, which is not a corner case: `pinned-engine.yml` points the guards at the
# store path `nix build .#engine` produces, and that path IS an out directory
# rather than a tree with one inside it. A library that only understood
# `out/<something>` would send that job at `$ENGINE/out/Domicile`, which does
# not exist, and the skip it produced would read as "no engine is pinned".
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

# A named out directory that is not there is a skip and not a pass, for the
# reason the unbuilt tree is: `engine-release.yml` names one it has just
# unpacked, and a typo there would otherwise be a guard reporting on a build
# nobody produced.
expect_skip "a named out directory that is missing is a skip" \
  "$ENGINE_LIB" \
  "DOMICILE_CHROMIUM='$WORK/built-tree' DOMICILE_ENGINE_OUT=no-such-build require_engine_out"

# --- and the guard is TOLD which build, not merely checked against it -------

# THE ASSERTION THIS FILE WAS MISSING, and run 35552949513 is what it cost. The
# cases above establish that the library resolves the right directory; not one
# of them established that the GUARD is given it. It was not: `require_engine_out`
# set its own `ENGINE_OUT` and never exported `OUT`, which is the variable the
# guards actually read -- so every guard fell back to its own default of
# `out/Domicile`, relative to whatever directory it was handed.
#
# That is invisible on the caller whose out directory IS `out/Domicile`, which
# is `engine.yml` and therefore the whole `engine` group. It is fatal on the two
# that name their own: `pinned-engine.yml` passes `.`, because the store path
# `nix build .#engine` produces is an out directory rather than a tree with one
# inside it, and it failed with `no engine at .../domicile-engine-c92e314/out/Domicile/chrome`
# -- a directory that cannot exist. `engine-release.yml` passes
# `out/Release-staged` and would have gone the same way on the next release.
#
# So what is asserted is the guard's own view of it, read out of a stand-in that
# reports what it was given. Bookkeeping the caller cannot see is not a contract.
echo "the guard is told which build to read"

STANDIN="$WORK/standin/packages/domicile-engine/scripts"
mkdir -p "$STANDIN"
cat >"$STANDIN/guard-says-what-it-got.sh" <<'GUARD'
#!/usr/bin/env bash
printf 'dir=%s out=%s negative=%s\n' "$1" "${OUT:-UNSET}" "${NEGATIVE:-unset}"
GUARD
chmod +x "$STANDIN/guard-says-what-it-got.sh"

# `lib-annotate.sh` too, because the library sources it from beside the guards.
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

# The one that failed in CI. `.` has to arrive as `.`, because the guard joins
# it to the directory and `out/Domicile` under a store path is nowhere.
touch "$WORK/store-engine-2/chrome"
got="$(saw "." "$WORK/store-engine-2")"
if [ "$got" = "dir=$WORK/store-engine-2 out=. negative=unset" ]; then
  ok "an engine that is its own out directory reaches the guard as ."
else
  fail "an engine that is its own out directory reaches the guard as ." \
    "the guard saw: $got"
fi

# --- whether the control runs is the caller's call ---------------------------

# A CHECK RUNS ITS CONTROL; TWO CALLERS SAY THEY DO NOT WANT IT, and both said
# so in prose before this refactor moved the decision. `pinned-engine.yml`:
#
#   No negative control alongside this. `engine.yml` already runs this script
#   with `NEGATIVE=1` to show it can fail, and that property belongs to the
#   script rather than to either caller -- a second copy here would buy nothing
#   and spend the slot twice.
#
# It is the job that runs on EVERY pull request, measured at 1m51s, and the
# control is another whole run of the same guard. `engine-release.yml` invokes
# it the same way, once per release. Folding the pair into the check overrode
# both silently, which is what this asserts against.
#
# DEFAULT ON, OPT OUT, and that direction is the whole safety of it: a caller
# that forgets to ask for the control gets it anyway, where the reverse would
# drop all eleven of the group's controls the first time somebody forgot. What
# stops the group ITSELF from opting out is asserted in
# `scripts/test-the-workflows-delegate-their-checks.sh`.
echo "whether the control runs"

# Set as its own statement, not as a prefix to `require_engine_out`. A variable
# assignment in front of a FUNCTION call does not outlive that call in bash --
# which is what keeps `NEGATIVE=1 engine_guard` from leaking into the next run,
# and which made the first version of this case set a variable nothing would
# ever read. `DOMICILE_GUARD_CONTROL` is read later, by `wants_control`.
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

# And it is the CONTROL that is dropped, never the guard. An opt-out that turned
# the pair off entirely would be a check measuring nothing and passing, which is
# the failure every other case in this file is about.
case "$got" in
  (*negative=1*)
    fail "opting out drops the control and not the guard" \
      "the control ran anyway: $got" ;;
  ('')
    fail "opting out drops the control and not the guard" \
      "nothing ran at all, so the check would pass having measured nothing" ;;
  (*) ok "opting out drops the control and not the guard" ;;
esac

echo "a nix check with no nix"

# `PATH` emptied rather than filtered, because a filter has to guess where nix
# is and the interesting case is only that it cannot be found. The library is
# allowed to need nothing else: it has one job before nix exists, which is to
# say so.
expect_skip "no nix is a skip, not a failure of the code" \
  "$NIX_LIB" "PATH='$WORK/nowhere' require_nix"

# THE POSITIVE, AND IT SYNTHESIZES ITS OWN NIX RATHER THAN NEEDING ONE. An
# earlier version skipped this case on a machine without nix, and exited 77 to
# say so — which made the whole file a skip on `ubuntu-latest`, where `e2e.yml`
# runs the `shell` group under `DOMICILE_CHECK_STRICT=1` and the only skip
# allowed is `e2e-dmabuf`. So it failed the job: run 35552949504, `58 passed, 1
# failed`, the one failure being this file declining to run.
#
# It was the wrong instinct twice over. `require_nix` asks `command -v nix`, so
# what the positive case needs is a `nix` on PATH and not a working Nix — and a
# stub is a better subject anyway, because it tests the library's own rule
# instead of the machine's. Nothing here is allowed to skip now.
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
