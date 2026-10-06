#!/usr/bin/env bash
# The `gclient sync` itself, from inside Chromium's shell.
#
#   NIX_SHELL_RUN=".../engine-sync-deps.sh /build/chromium/src <pin> <sentinel>" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# A separate file because NIX_SHELL_RUN's value passes through three shells,
# and a path survives that quoting where a composed command does not.
# engine-sync.sh decides when this runs.
set -euo pipefail

CHROMIUM="${1:?usage: engine-sync-deps.sh <chromium/src> <pin> <sentinel>}"
PIN="${2:?usage: engine-sync-deps.sh <chromium/src> <pin> <sentinel>}"
SENTINEL="${3:?usage: engine-sync-deps.sh <chromium/src> <pin> <sentinel>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

PATH="$("$HERE/engine-depot-tools.sh" "$CHROMIUM"):$PATH"
export PATH

# `.gclient` names the solution after the checkout's last path component.
SOLUTION="$(basename "$CHROMIUM")"

# Run from the directory that holds `.gclient`.
cd "$(dirname "$CHROMIUM")"

# - `--revision`: keeps a `managed` solution on the pin instead of its branch
#   head.
# - `--reset`: the tree is shared, and a locally modified dep would stop the
#   sync.
# - `--delete_unversioned_trees`: removes deps dropped from DEPS. A stale
#   third-party directory breaks the build with a confusing error.
#
# Hooks stay enabled because they fetch the clang the new pin needs.
gclient sync --revision "$SOLUTION@$PIN" --reset --delete_unversioned_trees

# Proves the sync finished. Chromium's shell can lose the exit status, so the
# caller checks for this file instead.
touch "$SENTINEL"
echo "engine-sync-deps.sh finished"
