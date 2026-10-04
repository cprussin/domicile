#!/usr/bin/env bash
# Print the path of a bootstrapped depot_tools.
#
#   export PATH="$(.github/scripts/engine-depot-tools.sh /build/chromium/src):$PATH"
#
# `gn`, `autoninja` and `gclient` come from depot_tools, which the systemd
# runner does not have on PATH.
#
# The checkout's third_party/depot_tools is often not bootstrapped, and its
# `autoninja` then fails. The bootstrap writes `python3_bin_reldir.txt`, so
# pick the first candidate that has it.
set -euo pipefail

CHROMIUM="${1:?usage: engine-depot-tools.sh <chromium/src>}"

for candidate in /build/depot_tools "$CHROMIUM/third_party/depot_tools"; do
  if [ -x "$candidate/autoninja" ] && [ -f "$candidate/python3_bin_reldir.txt" ]; then
    printf '%s\n' "$candidate"
    exit 0
  fi
done

{
  echo "no bootstrapped depot_tools in /build/depot_tools or $CHROMIUM/third_party/depot_tools."
  echo "One is there but not initialized: run its ensure_bootstrap, or gclient once."
  for candidate in /build/depot_tools "$CHROMIUM/third_party/depot_tools"; do
    printf '  %s: autoninja=%s bootstrapped=%s\n' "$candidate" \
      "$([ -x "$candidate/autoninja" ] && echo yes || echo no)" \
      "$([ -f "$candidate/python3_bin_reldir.txt" ] && echo yes || echo no)"
  done
} >&2
exit 127
