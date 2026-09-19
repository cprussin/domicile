#!/usr/bin/env bash
# Which depot_tools, answered in one place.
#
#   export PATH="$(.github/scripts/engine-depot-tools.sh /build/chromium/src):$PATH"
#
# `gn`, `autoninja` and `gclient` are depot_tools', not the nix shell's. An
# interactive user has them from their shell config; a systemd service has no
# shell config — the same reason the engine workflows have to supply NIX_PATH
# and a git identity.
#
# WHICH ONE IS NOT A MATTER OF TASTE. A checkout has a vendored copy at
# third_party/depot_tools, and it is a plain git clone: `autoninja` there exits
# with "python3_bin_reldir.txt not found. need to initialize depot_tools",
# because the bootstrap that fetches its own python has never run in it. The
# standalone one is what a person set this machine up with and what the first
# four-hour build used.
#
# So this picks the one that is bootstrapped rather than the one that sounds
# right — `python3_bin_reldir.txt` is what the bootstrap leaves behind, so it
# is the question asked directly.
#
# This was written four times: once in each of the three scripts that build in
# that tree, and a fourth was about to go into the sync. That is what this file
# is instead.
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
