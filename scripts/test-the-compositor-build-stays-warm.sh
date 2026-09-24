#!/usr/bin/env bash
# The engine group's compositor build keeps its cargo target across runs.
#
# Checkout wipes `target/` every run, so the compositor was a cold cargo build
# each time. Given DOMICILE_CARGO_TARGET, the build links `target` there first.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  if [ "$3" = "$2" ]; then printf '  ok    %s\n' "$1"; else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

mkdir -p "$WORK/repo/scripts/lib" "$WORK/bin" "$WORK/tree/out/Release"
cp "$ROOT/scripts/engine-build-the-compositor.sh" "$WORK/repo/scripts/"
cp "$ROOT/scripts/lib/engine-guard.sh" "$WORK/repo/scripts/lib/"
mkdir -p "$WORK/repo/packages/domicile-engine/scripts"
cp "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh" \
  "$WORK/repo/packages/domicile-engine/scripts/"
printf '#!/bin/sh\necho built >>"%s/cargo-ran"\n' "$WORK" >"$WORK/bin/cargo"
chmod +x "$WORK/bin/cargo"

build() {
  rm -f "$WORK/cargo-ran"
  PATH="$WORK/bin:$PATH" DOMICILE_CHROMIUM="$WORK/tree" \
    DOMICILE_ENGINE_OUT=out/Release "$WORK/repo/scripts/engine-build-the-compositor.sh" \
    >"$WORK/out" 2>&1
}

DOMICILE_CARGO_TARGET="$WORK/kept" build
expect "target is linked to the kept directory" "$WORK/kept" \
  "$(readlink "$WORK/repo/target")"
expect "and cargo builds into it" built "$(cat "$WORK/cargo-ran" 2>/dev/null)"

rm -f "$WORK/repo/target"
build
expect "without one, target is left alone" absent \
  "$([ -e "$WORK/repo/target" ] || [ -L "$WORK/repo/target" ] && echo present || echo absent)"

mkdir "$WORK/repo/target"
DOMICILE_CARGO_TARGET="$WORK/kept" build
expect "a real target directory is not replaced" directory \
  "$([ -d "$WORK/repo/target" ] && [ ! -L "$WORK/repo/target" ] && echo directory || echo replaced)"

[ "$FAILED" -eq 0 ] && { echo "all ok"; exit 0; }
echo "$FAILED failed"; exit 1
