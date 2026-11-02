#!/usr/bin/env bash
# Tests that `lib-engine-guard.sh` skips a guard with no built engine, and
# hands a guard the build and control its caller asked for.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE_LIB="$ROOT/packages/domicile-engine/scripts/lib-engine-guard.sh"
[ -f "$ENGINE_LIB" ] || { echo "no $ENGINE_LIB" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=packages/check-runner/src/skip-assertions.sh
. "$ROOT/packages/check-runner/src/skip-assertions.sh"

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
# `packages/ci/tests/test-the-workflows-delegate-their-checks.sh` checks `engine.yml`
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

skip_assertions_end
