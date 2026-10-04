#!/usr/bin/env bash
# Tests that the engine build scripts pass `gn` a compiler cache when one is
# named, refuse a named cache that is missing, and pass none when unnamed.
#
# `gn` bakes `cc_wrapper` into every compile command, so a silent fallback
# would cost a full rebuild. Refusals must happen before `gn` runs.
#
# Skips (exit 77) on crux, where `engine-depot-tools.sh` prefers the
# bootstrapped /build/depot_tools over this test's fakes. check.sh reads the
# reason from the first `SKIP: ` line.
if [ -x /build/depot_tools/autoninja ] &&
  [ -f /build/depot_tools/python3_bin_reldir.txt ]; then
  echo "SKIP: /build/depot_tools is bootstrapped here, so the build scripts would resolve the real gn ahead of this test's fakes"
  exit 77
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MEASURED="$ROOT/packages/domicile-engine/scripts/build.sh"
RELEASE="$ROOT/.github/scripts/engine-release-build.sh"
IN_JOB="$ROOT/.github/scripts/engine-build.sh"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A renamed variable must not let every case below pass vacuously.
for build in "$MEASURED" "$RELEASE" "$IN_JOB"; do
  [ -f "$build" ] || { echo "no build script at $build" >&2; exit 1; }
  grep -q 'DOMICILE_CC_WRAPPER' "$build" || {
    echo "$build does not mention DOMICILE_CC_WRAPPER, so it cannot be" >&2
    echo "reading one and the cases below would pass over a build that" >&2
    echo "silently stopped caching." >&2
    exit 1
  }
done

# Variables exported by this machine would satisfy the assertions below.
unset CCACHE_BASEDIR CCACHE_NOHASHDIR

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The scripts only `cd` into the checkout and pass it to `gn`, so an empty
# directory works, plus the two depot_tools files engine-depot-tools.sh checks
# for.
SRC="$WORK/src"
mkdir -p "$SRC/third_party/depot_tools"
: >"$SRC/third_party/depot_tools/python3_bin_reldir.txt"

# The fake `gn` records its arguments. Both scripts `exec` `autoninja`, so a
# fake that exits 0 lets the test read gn's file afterwards.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gn" <<'GN'
#!/bin/sh
printf '%s\n' "$@" >"$GN_ARGS_FILE"
GN
cat >"$WORK/bin/autoninja" <<'NINJA'
#!/bin/sh
printf '%s\n' "$*" >>"${NINJA_ARGS_FILE:-/dev/null}"
printf 'CCACHE_BASEDIR=%s\nCCACHE_NOHASHDIR=%s\n' \
  "${CCACHE_BASEDIR:-}" "${CCACHE_NOHASHDIR:-}" >"${NINJA_ENV_FILE:-/dev/null}"
exit 0
NINJA
cp "$WORK/bin/autoninja" "$SRC/third_party/depot_tools/autoninja"
chmod +x "$WORK/bin/gn" "$WORK/bin/autoninja" \
  "$SRC/third_party/depot_tools/autoninja"

# A working cache, and a file that exists but is not executable. The build
# need not distinguish a missing cache from a broken one.
CACHE="$WORK/bin/ccache"
cat >"$CACHE" <<'CCACHE'
#!/bin/sh
case "${1:-}" in
  --zero-stats) echo "ccache zeroed" >>"${NINJA_ARGS_FILE:-/dev/null}"; exit 0 ;;
  --show-stats)
    [ "${2:-}" = -v ] && echo "Could not use modules: 7 / 7"
    echo "Hits: 41 / 43"; exit 0 ;;
  *) exec "$@" ;;
esac
CCACHE
chmod +x "$CACHE"

# A ccache that compiles but fails its stats commands, as happens with an
# unreadable cache directory, a full disk, or a wrapper that is not ccache.
MUTE="$WORK/bin/mute-ccache"
cat >"$MUTE" <<'MUTE'
#!/bin/sh
case "${1:-}" in
  --zero-stats | --show-stats) exit 3 ;;
  *) exec "$@" ;;
esac
MUTE
chmod +x "$MUTE"
NOT_EXECUTABLE="$WORK/not-executable"
: >"$NOT_EXECUTABLE"

# Chromium's cc_wrapper.gni documents `cc_wrapper = "ccache"`, so a bare
# name on PATH must work.
BY_NAME="ccache"

# Runs a build script with the fakes first on PATH. Leaves `gn` arguments in
# $GN_ARGS_FILE.
run_build() {
  local build="$1"
  GN_ARGS_FILE="$WORK/gn-args"
  export GN_ARGS_FILE
  rm -f "$GN_ARGS_FILE"
  STATUS=0
  PATH="$WORK/bin:$PATH" "$build" "$SRC" >"$WORK/out" 2>&1 || STATUS=$?
  return "$STATUS"
}

# engine-build.sh takes a sentinel and reports cache stats, so run it.
run_job() {
  GN_ARGS_FILE="$WORK/gn-args"
  export GN_ARGS_FILE
  NINJA_ARGS_FILE="$WORK/ninja-args"
  export NINJA_ARGS_FILE
  rm -f "$GN_ARGS_FILE" "$NINJA_ARGS_FILE" "$WORK/sentinel"
  STATUS=0
  PATH="$WORK/bin:$PATH" "$IN_JOB" "$SRC" "$WORK/sentinel" \
    >"$WORK/out" 2>&1 || STATUS=$?
  return "$STATUS"
}

for build in "$MEASURED" "$RELEASE"; do
  name="$(basename "$build")"

  # No cache named is not an error; every machine except crux builds this way.
  unset DOMICILE_CC_WRAPPER
  if run_build "$build"; then
    if grep -q 'cc_wrapper' "$WORK/gn-args"; then
      fail "$name asks for no cache when none is named" \
        "it passed cc_wrapper anyway: $(grep -o 'cc_wrapper.*' "$WORK/gn-args")"
    else
      ok "$name asks for no cache when none is named"
    fi
  else
    fail "$name asks for no cache when none is named" \
      "it exited $STATUS instead: $(cat "$WORK/out")"
  fi

  # Quoted, since gn rejects an unquoted path.
  export DOMICILE_CC_WRAPPER="$CACHE"
  if run_build "$build"; then
    if grep -qF "cc_wrapper = \"$CACHE\"" "$WORK/gn-args"; then
      ok "$name hands gn the cache it was given"
    else
      fail "$name hands gn the cache it was given" \
        "no 'cc_wrapper = \"$CACHE\"' among: $(cat "$WORK/gn-args")"
    fi
  else
    fail "$name hands gn the cache it was given" \
      "it exited $STATUS instead: $(cat "$WORK/out")"
  fi

  # crux builds in several /build/trees/tree-N/src directories. Without a
  # shared base directory, a cache entry from one tree misses in every other.
  # Use the physical path, since ccache compares it with getcwd. Read from
  # autoninja's environment, which the compiles inherit.
  NINJA_ENV_FILE="$WORK/ninja-env"
  export NINJA_ENV_FILE
  rm -f "$NINJA_ENV_FILE"
  run_build "$build"
  if grep -qxF "CCACHE_BASEDIR=$(cd "$SRC" && pwd -P)" "$NINJA_ENV_FILE" &&
    grep -qx 'CCACHE_NOHASHDIR=1' "$NINJA_ENV_FILE"; then
    ok "$name keys the cache on the source, not on which tree holds it"
  else
    fail "$name keys the cache on the source, not on which tree holds it" \
      "autoninja ran with: $(cat "$NINJA_ENV_FILE" 2>/dev/null)"
  fi
  unset NINJA_ENV_FILE

  # A bare name must resolve, since cc_wrapper.gni documents `ccache`.
  export DOMICILE_CC_WRAPPER="$BY_NAME"
  if run_build "$build"; then
    if grep -qF "cc_wrapper = \"$BY_NAME\"" "$WORK/gn-args"; then
      ok "$name takes a cache named without a path"
    else
      fail "$name takes a cache named without a path" \
        "no 'cc_wrapper = \"$BY_NAME\"' among: $(cat "$WORK/gn-args")"
    fi
  else
    fail "$name takes a cache named without a path" \
      "it exited $STATUS: $(cat "$WORK/out")"
  fi

  # A missing or non-executable cache must be refused. Falling back would
  # rebuild Chromium from scratch without saying so.
  for absent in "$WORK/nothing-is-here" "$NOT_EXECUTABLE"; do
    export DOMICILE_CC_WRAPPER="$absent"
    case "$absent" in
      "$NOT_EXECUTABLE") what="is not executable" ;;
      *) what="is not there" ;;
    esac
    if run_build "$build"; then
      fail "$name refuses a cache that $what" \
        "it exited 0 and passed: $(cat "$WORK/gn-args")"
    elif [ -e "$WORK/gn-args" ]; then
      # Refusing after `gn gen` is too late: it has already rewritten
      # out/Domicile.
      fail "$name refuses a cache that $what" \
        "it refused only after reaching gn, which had already written: $(cat "$WORK/gn-args")"
    elif grep -qF "$absent" "$WORK/out"; then
      ok "$name refuses a cache that $what"
    else
      fail "$name refuses a cache that $what" \
        "it failed without naming $absent: $(cat "$WORK/out")"
    fi
  done
  unset DOMICILE_CC_WRAPPER
done

# A failed cache report must not cut off the log. The sentinel decides the
# step's result and engine-build-in-shell.sh only prints the exit status, so
# failing here would lose output without failing anything.
#
# With no cache set, the job must still say so.
unset DOMICILE_CC_WRAPPER
if run_job; then
  if ! grep -q 'DOMICILE_CC_WRAPPER' "$WORK/out"; then
    fail "the job says when no cache reached it" \
      "it said nothing about the variable: $(cat "$WORK/out")"
  elif grep -q 'engine-build.sh finished' "$WORK/out"; then
    ok "the job says when no cache reached it"
  else
    fail "the job says when no cache reached it" \
      "it did not finish: $(cat "$WORK/out")"
  fi
else
  fail "the job says when no cache reached it" \
    "it exited $STATUS: $(cat "$WORK/out")"
fi

# The job builds only the shipped configuration (out/Release), with every
# target the checks load and DCHECKs on.
echo "the job builds the shipped configuration, and only that"
unset DOMICILE_CC_WRAPPER
run_job
ninja="$(cat "$WORK/ninja-args" 2>/dev/null)"
case "$ninja" in
  (*out/Domicile*) fail "the job does not build out/Domicile" "autoninja ran: $ninja" ;;
  (*) ok "the job does not build out/Domicile" ;;
esac
case "$ninja" in
  (*components_unittests*) fail "the job does not build all of components_unittests" "autoninja ran: $ninja" ;;
  (*) ok "the job does not build all of components_unittests" ;;
esac
for target in chrome domicile_engine domicile_unittests ozone_unittests \
    domicile_css_parity domicile_color_probe domicile_solid_color_submitter; do
  if printf '%s\n' "$ninja" | grep -qE "out/Release( .*)? $target( |$)"; then
    ok "out/Release builds $target"
  else
    fail "out/Release builds $target" "autoninja ran: $ninja"
  fi
done
if grep -q 'dcheck_always_on = true' "$WORK/gn-args" 2>/dev/null; then
  ok "with DCHECKs on"
else
  fail "with DCHECKs on" "gn was given: $(cat "$WORK/gn-args" 2>/dev/null)"
fi

export DOMICILE_CC_WRAPPER="$CACHE"
if run_job; then
  if grep -q '  ccache Hits: 41 / 43' "$WORK/out"; then
    ok "the job reports the cache's statistics"
  else
    fail "the job reports the cache's statistics" \
      "no ccache line among: $(cat "$WORK/out")"
  fi
  # The cache is shared, so zero its stats to report this build alone, and show
  # why calls went uncached.
  if [ "$(head -1 "$WORK/ninja-args")" = "ccache zeroed" ]; then
    ok "the job zeroes the statistics before it builds"
  else
    fail "the job zeroes the statistics before it builds" \
      "ccache and autoninja ran: $(cat "$WORK/ninja-args")"
  fi
  if grep -q '  ccache Could not use modules' "$WORK/out"; then
    ok "the job reports why calls went uncached"
  else
    fail "the job reports why calls went uncached" \
      "no verbose statistics among: $(cat "$WORK/out")"
  fi
else
  fail "the job reports the cache's statistics" \
    "it exited $STATUS: $(cat "$WORK/out")"
fi

export DOMICILE_CC_WRAPPER="$MUTE"
if run_job; then
  if ! grep -qF "$MUTE" "$WORK/out"; then
    fail "a cache that will not report says so and the build still finishes" \
      "it said nothing about $MUTE: $(cat "$WORK/out")"
  elif grep -q '::warning::' "$WORK/out"; then
    # The tail's `  | ` prefix breaks workflow commands, so a `::warning::`
    # there would look parsed but is not.
    fail "a cache that will not report says so and the build still finishes" \
      "it emitted a ::warning:: that the tail's prefix makes unparseable"
  elif grep -q 'engine-build.sh finished' "$WORK/out"; then
    ok "a cache that will not report says so and the build still finishes"
  else
    fail "a cache that will not report says so and the build still finishes" \
      "the report took the rest of the log with it: $(cat "$WORK/out")"
  fi
else
  fail "a cache that will not report says so and the build still finishes" \
    "it exited $STATUS, failing a build that succeeded: $(cat "$WORK/out")"
fi
unset DOMICILE_CC_WRAPPER

# The official build uses the same script with PGO and ThinLTO and no
# DCHECKs. PGO needs Google's profile for this revision, so the script fetches
# it. A stand-in records the fetch instead of reaching Google Cloud Storage.
mkdir -p "$SRC/tools"
cat >"$SRC/tools/update_pgo_profiles.py" <<'PGO'
import os, sys
open(os.environ["PGO_ARGS_FILE"], "w").write(" ".join(sys.argv[1:]))
PGO
export PGO_ARGS_FILE="$WORK/pgo-args"
# V8's builtins have their own profile and fetch hook. Without it an official
# build fails at `gen/v8/embedded.S`.
mkdir -p "$SRC/v8/tools/builtins-pgo"
cat >"$SRC/v8/tools/builtins-pgo/download_profiles.py" <<'V8PGO'
import os, sys
open(os.environ["V8_PGO_ARGS_FILE"], "w").write(" ".join(sys.argv[1:]))
V8PGO
export V8_PGO_ARGS_FILE="$WORK/v8-pgo-args"
echo "the official build"
rm -f "$PGO_ARGS_FILE"
if DOMICILE_ENGINE_BUILD=official run_build "$RELEASE"; then
  for arg in 'is_official_build = true' 'dcheck_always_on = false'; do
    if grep -qx "  $arg" "$WORK/gn-args"; then
      ok "is built with $arg"
    else
      fail "is built with $arg" "gn was given: $(cat "$WORK/gn-args")"
    fi
  done
  if grep -q -- '--target=linux update' "$PGO_ARGS_FILE" 2>/dev/null; then
    ok "and fetches the PGO profile first"
  else
    fail "and fetches the PGO profile first" \
      "the fetcher was run with: $(cat "$PGO_ARGS_FILE" 2>/dev/null)"
  fi
  if grep -q -- '^download .*--depot-tools ' "$V8_PGO_ARGS_FILE" 2>/dev/null; then
    ok "and V8's builtins profile"
  else
    fail "and V8's builtins profile" \
      "V8's fetcher was run with: $(cat "$V8_PGO_ARGS_FILE" 2>/dev/null)"
  fi
else
  fail "the official build runs" "it exited $STATUS: $(cat "$WORK/out")"
fi
rm -f "$PGO_ARGS_FILE" "$V8_PGO_ARGS_FILE"
run_build "$RELEASE"
if grep -qx '  is_official_build = false' "$WORK/gn-args" &&
  [ ! -e "$PGO_ARGS_FILE" ] && [ ! -e "$V8_PGO_ARGS_FILE" ]; then
  ok "and the checked build is not official, and fetches no profile"
else
  fail "and the checked build is not official, and fetches no profile" \
    "gn was given: $(cat "$WORK/gn-args"); the fetcher ran: $(cat "$PGO_ARGS_FILE" 2>/dev/null)"
fi
if DOMICILE_ENGINE_BUILD=fast run_build "$RELEASE"; then
  fail "a build nobody defined is refused" "it exited 0"
elif [ -e "$WORK/gn-args" ]; then
  fail "a build nobody defined is refused" "only after gn: $(cat "$WORK/gn-args")"
else
  ok "a build nobody defined is refused"
fi
unset PGO_ARGS_FILE V8_PGO_ARGS_FILE

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
