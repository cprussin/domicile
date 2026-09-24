#!/usr/bin/env bash
# Whether the two engine builds hand `gn` a compiler cache when the machine has
# one, refuse when it is named and missing, and ask for none when it is not.
#
# The argument line is part of the build's identity: `gn` bakes `cc_wrapper`
# into every compile command, so a `gn gen` that quietly fell back to no
# wrapper would cost a full rebuild and report nothing. Hence the refusals are
# asserted, and asserted to happen before `gn` is reached.
#
# NOT VALID ON crux, which has a bootstrapped /build/depot_tools that
# `engine-depot-tools.sh` prefers and puts ahead of this file's fakes. 77 so
# `check.sh` reports a skip rather than a confusing red; the hosted runner has
# no /build and never takes this branch.
#
# `SKIP: ` on one line is the whole of the form -- check.sh lifts the reason
# with `sed -n 's/^ *SKIP: *//p' | head -1`.
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

# The positive first: a renamed variable must not pass every case below
# vacuously, which is how the ozone test next door lost its grip once already.
for build in "$MEASURED" "$RELEASE" "$IN_JOB"; do
  [ -f "$build" ] || { echo "no build script at $build" >&2; exit 1; }
  grep -q 'DOMICILE_CC_WRAPPER' "$build" || {
    echo "$build does not mention DOMICILE_CC_WRAPPER, so it cannot be" >&2
    echo "reading one and the cases below would pass over a build that" >&2
    echo "silently stopped caching." >&2
    exit 1
  }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A checkout is only ever `cd`-ed into and handed to `gn`, so an empty
# directory is the whole of it -- plus the bootstrapped depot_tools the release
# script resolves through engine-depot-tools.sh, which asks for exactly these
# two files.
SRC="$WORK/src"
mkdir -p "$SRC/third_party/depot_tools"
: >"$SRC/third_party/depot_tools/python3_bin_reldir.txt"

# `gn` records the arguments, on PATH ahead of anything real. `autoninja` only
# has to succeed and is not read: both build scripts `exec` it, so a fake that
# exits 0 is what lets this read gn's file afterwards.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/gn" <<'GN'
#!/bin/sh
printf '%s\n' "$@" >"$GN_ARGS_FILE"
GN
cat >"$WORK/bin/autoninja" <<'NINJA'
#!/bin/sh
printf '%s\n' "$*" >>"${NINJA_ARGS_FILE:-/dev/null}"
exit 0
NINJA
cp "$WORK/bin/autoninja" "$SRC/third_party/depot_tools/autoninja"
chmod +x "$WORK/bin/gn" "$WORK/bin/autoninja" \
  "$SRC/third_party/depot_tools/autoninja"

# The cache itself, and a file that is present and not executable: those are
# different failures on a real machine -- a ccache that was garbage collected
# versus one whose symlink points at a directory -- and the build has no
# business telling them apart.
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

# A ccache that compiles and will not answer for itself. Not a contrived case:
# an unreadable cache directory, a full filesystem and a DOMICILE_CC_WRAPPER
# pointing at something that is not ccache all land here.
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

# `cc_wrapper = "ccache"` is the form Chromium's cc_wrapper.gni documents, so a
# bare name is a thing somebody will set. It is on PATH here because $WORK/bin
# is, which is exactly how it would be on a machine that has ccache.
BY_NAME="ccache"

# Each case runs a build script with PATH holding the fakes and nothing else
# that matters, and leaves its `gn` arguments in $GN_ARGS_FILE for the caller.
run_build() {
  local build="$1"
  GN_ARGS_FILE="$WORK/gn-args"
  export GN_ARGS_FILE
  rm -f "$GN_ARGS_FILE"
  STATUS=0
  PATH="$WORK/bin:$PATH" "$build" "$SRC" >"$WORK/out" 2>&1 || STATUS=$?
  return "$STATUS"
}

# engine-build.sh is the one that takes a sentinel and reports the cache, so it
# is run rather than read.
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

  # NO CACHE NAMED IS NOT AN ERROR. Every machine that is not crux builds this
  # way, including the container the rest of this suite runs in.
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

  # THE CACHE, NAMED AS THE ARGUMENT `gn` BAKES. Quoted, because gn's argument
  # grammar makes an unquoted path a syntax error rather than a string.
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

  # A bare name resolves: refusing `ccache`, the spelling Chromium's
  # cc_wrapper.gni documents, would be a refusal nobody could read.
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

  # AND THE TWO REFUSALS, which are the point of the file. A build that fell
  # back here would compile Chromium from scratch and say nothing.
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
      # Refusing after `gn gen` has already rewritten out/Domicile, which is
      # the rebuild this exists to prevent.
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

# WHAT THE JOB REPORTS. A failed report must not take the rest of the log with
# it: the step's verdict is the sentinel, and engine-build-in-shell.sh only
# PRINTS the shell's exit status, so throwing here would fail nothing and lose
# the lines below.
#
# The unset case matters most: a run that lost the variable builds uncached
# and would otherwise print nothing about a cache at all.
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

# ONE CONFIGURATION: the job's build is the one that ships, with every target
# the checks load, and with DCHECKs on -- out/Domicile had them by default.
echo "the job builds the shipped configuration, and only that"
unset DOMICILE_CC_WRAPPER
run_job
ninja="$(cat "$WORK/ninja-args" 2>/dev/null)"
case "$ninja" in
  (*out/Domicile*) fail "the job does not build out/Domicile" "autoninja ran: $ninja" ;;
  (*) ok "the job does not build out/Domicile" ;;
esac
for target in chrome domicile_engine components_unittests ozone_unittests \
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
  # Per build, and why a call went uncached: the cache is shared, so its
  # running totals mix every build that ever ran.
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
    # The tail's `  | ` prefix makes a workflow command unparseable, and an
    # unparsed `::` reads as though it had been parsed.
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

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
