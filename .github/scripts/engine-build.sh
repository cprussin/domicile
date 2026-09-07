#!/usr/bin/env bash
# Build the engine, from inside Chromium's shell.
#
#   NIX_SHELL_RUN=".../engine-build.sh /build/chromium/src /tmp/ran" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# A FILE, NOT A STRING. This began as a command composed in the workflow and
# handed through NIX_SHELL_RUN, which meant its quoting was interpreted by the
# workflow's shell, then by chromium-env-run, then by the `bash -c` underneath
# — and a message containing a semicolon came out the far end as
# `looked: command not found`. Three layers of quoting is two too many. A path
# to a script survives all of them unaltered.
set -euo pipefail

CHROMIUM="${1:?usage: engine-build.sh <chromium/src> <sentinel>}"
SENTINEL="${2:?usage: engine-build.sh <chromium/src> <sentinel>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# `gn` and `autoninja` are depot_tools', not the nix shell's. An interactive
# user has them from their shell config; a systemd service has no shell config
# — the same reason this workflow has to supply NIX_PATH and a git identity.
#
# WHICH depot_tools is not a matter of taste. A checkout has a vendored copy at
# third_party/depot_tools, and it is a plain git clone: `autoninja` there exits
# with "python3_bin_reldir.txt not found. need to initialize depot_tools",
# because the bootstrap that fetches its own python has never run in it. The
# standalone one is what a person set this machine up with and what the first
# four-hour build used.
#
# So this picks the one that is bootstrapped rather than the one that sounds
# right — `python3_bin_reldir.txt` is what the bootstrap leaves behind, so it
# is the question asked directly.
TOOLS=""
for candidate in /build/depot_tools "$CHROMIUM/third_party/depot_tools"; do
  if [ -x "$candidate/autoninja" ] && [ -f "$candidate/python3_bin_reldir.txt" ]; then
    TOOLS="$candidate"
    break
  fi
done
[ -n "$TOOLS" ] || {
  echo "no bootstrapped depot_tools in /build/depot_tools or $CHROMIUM/third_party/depot_tools." >&2
  echo "One is there but not initialised: run its ensure_bootstrap, or gclient once." >&2
  for candidate in /build/depot_tools "$CHROMIUM/third_party/depot_tools"; do
    printf '  %s: autoninja=%s bootstrapped=%s\n' "$candidate" \
      "$([ -x "$candidate/autoninja" ] && echo yes || echo no)" \
      "$([ -f "$candidate/python3_bin_reldir.txt" ] && echo yes || echo no)" >&2
  done
  exit 127
}
echo "depot_tools: $TOOLS"
export PATH="$TOOLS:$PATH"

"$HERE/../../packages/domicile-engine/scripts/build.sh" "$CHROMIUM"

# `domicile_engine` because nothing in chrome depends on it and the compositor
# dlopens it by name; `components_unittests` because patch 0001 registers the
# broker's tests into it.
autoninja -C "$CHROMIUM/out/Domicile" domicile_engine components_unittests

# The proof that this ran at all. Chromium's shell has swallowed an exit status
# more than once in this workflow's short life, so the step that called this
# checks for the file rather than believing the code.
touch "$SENTINEL"
echo "engine-build.sh finished"
