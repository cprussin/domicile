#!/usr/bin/env bash
# Every webview guard, started in the shell CI actually runs it in.
#
# `crux` runs these inside `nix develop .#full`, and that shell exports the
# toolchain's own names — CC, LD, AR, NM, STRIP and the rest. A guard that
# takes one of those for itself does not get its default: `STRIP="${STRIP:-64}"`
# keeps `strip`, the program, and the arithmetic on the next line then
# dereferences it as a variable, which under `set -u` kills the guard before it
# has started anything.
#
# That is not hypothetical. It is what engine.yml run 180 did: four hours of
# shared tree, the whole series built, every other guard run and passed, and
# then one line of variable naming ended the job. Nothing in the check suite
# could have caught it, because the guard is never *started* here — a machine
# without an engine skips it, which it does at a line below the one that died.
#
# So each guard is started here, with those names set the way that shell sets
# them and pointed at a path with no engine in it. What it must do is reach its
# own "no engine" refusal: that is proof it got through every assignment, every
# default and every piece of arithmetic above it, in an environment that is
# hostile in the one way the real one is.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARDS="$ROOT/packages/domicile-engine/scripts"

# The names a build shell puts in the environment, with the values it puts
# there: programs, which is what makes them poison in arithmetic. Not an
# exhaustive list of what nix exports — an exhaustive list is not the point.
# These are the ones a person naming a variable in a shell script would reach
# for without thinking.
TOOLCHAIN=(
  AR=ar
  AS=as
  CC=cc
  CXX=c++
  LD=ld
  NM=nm
  OBJCOPY=objcopy
  OBJDUMP=objdump
  RANLIB=ranlib
  READELF=readelf
  SIZE=size
  STRINGS=strings
  STRIP=strip
)

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

# A path with nothing in it, so every guard stops at the same place for the
# same reason. Not a path that does not exist: `-x` answers the same either
# way, and a directory says plainly that the run got as far as looking.
NOWHERE="$(mktemp -d)"
trap 'rm -rf "$NOWHERE"' EXIT

for guard in "$GUARDS"/guard-webview-*.sh; do
  name="$(basename "$guard")"
  echo "$name"
  said="$(env "${TOOLCHAIN[@]}" "$guard" "$NOWHERE" 2>&1)"
  status=$?
  # The refusal, rather than any non-zero exit: a guard that died on an unbound
  # variable also exits 1, which is the whole failure this exists to tell apart.
  case "$said" in
  *"no engine at"*) reached="the engine check" ;;
  *) reached="$said" ;;
  esac
  expect "reaches its own refusal in a build shell" "the engine check" "$reached"
  expect "and says so as a failure" "1" "$status"
  echo
done

if [ "$FAILED" -eq 0 ]; then
  echo "every webview guard starts in the shell it is run in"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
