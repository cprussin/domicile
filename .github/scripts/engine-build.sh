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
# The checkout's own vendored copy first: a gclient checkout puts depot_tools
# at third_party/depot_tools, and that one matches this tree.
TOOLS="$CHROMIUM/third_party/depot_tools:/build/depot_tools"
export PATH="$TOOLS:$PATH"
command -v autoninja >/dev/null || {
  echo "no autoninja on PATH; looked in $TOOLS" >&2
  exit 127
}

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
