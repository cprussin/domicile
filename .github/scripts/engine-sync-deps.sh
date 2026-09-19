#!/usr/bin/env bash
# The `gclient sync` itself, from inside Chromium's shell.
#
#   NIX_SHELL_RUN=".../engine-sync-deps.sh /build/chromium/src <pin> <sentinel>" \
#     nix-shell /build/chromium/src/tools/nix/shell.nix
#
# Split from `engine-sync.sh` for the reason `engine-build.sh` is a file rather
# than a string: NIX_SHELL_RUN's value is interpreted by the caller's shell,
# then by chromium-env-run, then by the `bash -c` underneath, and three layers
# of quoting is two too many. A path survives all of them.
#
# Everything about when this should run, and what must not be written if it
# does not finish, is in engine-sync.sh. This part is the command.
set -euo pipefail

CHROMIUM="${1:?usage: engine-sync-deps.sh <chromium/src> <pin> <sentinel>}"
PIN="${2:?usage: engine-sync-deps.sh <chromium/src> <pin> <sentinel>}"
SENTINEL="${3:?usage: engine-sync-deps.sh <chromium/src> <pin> <sentinel>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

PATH="$("$HERE/engine-depot-tools.sh" "$CHROMIUM"):$PATH"
export PATH

# The solution's name is the directory `.gclient` knows it by, which is the
# last component of the checkout — `src` for a tree `fetch chromium` made.
SOLUTION="$(basename "$CHROMIUM")"

# From beside `.gclient` rather than from inside the solution: gclient searches
# upward for it, so both work, and the one that reads as deliberate is the one
# that starts where the file is.
cd "$(dirname "$CHROMIUM")"

# `--revision` because a `managed` solution would otherwise take the checkout
# to the head of its branch and off the pin — engine-sync.sh asserts it did
# not. `--reset` because this tree is shared and a dep somebody or some hook
# left modified would otherwise stop the sync. `-D` because a dep that has left
# DEPS between two pins stays on disk without it, and a stale third-party
# directory in a Chromium checkout is a build failure with a confusing message.
#
# Hooks are deliberately not suppressed: they are what fetch the clang the new
# pin wants, and a sync that leaves the toolchain behind is the same half-rolled
# tree this exists to prevent.
gclient sync --revision "$SOLUTION@$PIN" --reset --delete_unversioned_trees

# The proof that this ran at all, and the last thing it does. Chromium's shell
# has swallowed an exit status more than once in this workflow's short life, so
# the caller checks for the file rather than believing the code.
touch "$SENTINEL"
echo "engine-sync-deps.sh finished"
