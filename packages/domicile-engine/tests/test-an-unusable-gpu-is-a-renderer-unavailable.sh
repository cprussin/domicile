#!/usr/bin/env bash
# Checks that an engine with no usable GPU exits with the code the launcher
# reads as a renderer unavailable.
#
# Once every GPU mode has failed, the CPU included, patch 0178 exits the
# browser 69. `renderer_unavailable` in domicile-launch's `restart.rs` ends the
# run on 69 instead of restarting the engine on a black screen. Guards either
# side changing alone.
#
# Reads `patches/` instead of a Chromium tree, so it runs in the shell group.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
RESTART="$ROOT/packages/domicile-launch/src/restart.rs"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

# The code the browser exits with where it gave up on the GPU.
engine="$(awk '
  /^diff --git a\// { in_file = ($0 ~ /content\/browser\/gpu\/gpu_data_manager_impl_private\.cc$/); next }
  in_file && /^\+.*TerminateCurrentProcessImmediately\(/ { print }
' "$PATCHES"/*.patch | grep -oE '\(([0-9]+)\)' | tr -d '()')"
launcher="$(grep -oE 'NO_USABLE_GPU: &str = "exit status: [0-9]+"' "$RESTART" | grep -oE '[0-9]+')"

name="an unusable GPU is a renderer unavailable"
if [ -z "$engine" ]; then
  printf '  FAIL  %s\n    %s\n' "$name" "no patch makes the browser exit when its GPU is unusable"
  exit 1
fi
if [ "$engine" != "$launcher" ]; then
  printf '  FAIL  %s\n    %s\n' "$name" "the engine exits $engine, the launcher stops on ${launcher:-nothing}"
  exit 1
fi
printf '  ok    %s\n' "$name"
