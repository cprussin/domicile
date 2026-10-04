#!/usr/bin/env bash
# Starts every webview guard with the toolchain variables CI's build shell
# sets, and checks each reaches its "no engine" refusal.
#
# `crux` runs guards inside `nix develop .#full`, which exports CC, LD, STRIP
# and similar. A guard that reuses one of those names gets the program name
# instead of its default (`STRIP="${STRIP:-64}"` keeps `strip`), and arithmetic
# on it fails under `set -u`. The check suite has no engine, so the guards
# normally skip, but only after the lines that would fail. This script runs
# each guard far enough to reach them.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARDS="$ROOT/packages/domicile-engine/scripts"

# Variables a build shell sets, with program names as values. Not exhaustive:
# these are the names a script author is likely to reuse.
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

# An empty directory, so every guard stops at the engine check.
NOWHERE="$(mktemp -d)"
trap 'rm -rf "$NOWHERE"' EXIT

for guard in "$GUARDS"/guard-webview-*.sh; do
  name="$(basename "$guard")"
  echo "$name"
  said="$(env "${TOOLCHAIN[@]}" "$guard" "$NOWHERE" 2>&1)"
  status=$?
  # Match the refusal, not any non-zero exit: an unbound variable also exits
  # 1.
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
