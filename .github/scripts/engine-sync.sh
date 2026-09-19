#!/usr/bin/env bash
# Put the shared checkout's DEPS at the pin, so a repin needs nobody on `crux`.
#
#   .github/scripts/engine-sync.sh /build/chromium/src
#
# Moving `CHROMIUM_PIN` moves two things, and only one of them is a commit.
# `engine-reset.sh` fetches the revision and resets the tree onto it; that
# leaves every third-party checkout under it — the toolchain, the sysroots,
# everything `DEPS` names — at the *previous* pin's revisions, which is not a
# tree Chromium builds from. `gclient sync` is what moves the other half, and
# until this script existed it was a person logging into the build host: all
# three engine workflows checked that the pin was there and stopped with an
# instruction when it was not.
#
# RUN AFTER THE RESET AND BEFORE `apply.sh`. gclient wants a clean tree at the
# revision it is syncing for — the reset is what makes it one — and the series
# has to go on afterward, because `apply.sh` refuses a dirty tree and a sync
# writes into one.
#
# WHAT IT COSTS ON AN ORDINARY RUN IS ONE `cat`. A sync in front of every job
# would be minutes of `gclient` ahead of a ~1m incremental build, on the one
# machine that has the tree and one job slot to run it in. So the pin the DEPS
# were last synced to is written down beside the checkout, and a run whose pin
# matches it does not start `gclient` at all. The run that does pay for it is
# the repin — which is rebuilding most of Chromium anyway, so a few minutes of
# sync is not the number that matters in it.
#
# The stamp is written only after a sync finishes and only if the tree is still
# at the pin: a tree half-way between two pins, described as either, is a build
# against a mixture. That is the same failure `engine-tree-lock.sh` prevents by
# another route, and it is silent both ways.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || { echo "usage: $(basename "$0") <chromium checkout>" >&2; exit 2; }

pin="$(grep -v '^#' "$ROOT/packages/domicile-engine/CHROMIUM_PIN" | tr -d '[:space:]')"

# Beside the checkout rather than inside it, for the reason the tree lock is:
# a file inside `src/` is untracked in Chromium's repository, which is exactly
# what makes `git status --porcelain` non-empty, which is exactly what
# `apply.sh` refuses. Override for tests, which have no /build.
STAMP="${DOMICILE_SYNCED_PIN:-$(dirname "$CHROMIUM")/.domicile-synced-pin}"

if [ "$(cat "$STAMP" 2>/dev/null || true)" = "$pin" ]; then
  echo "DEPS are already at $pin"
  exit 0
fi

echo "syncing DEPS to $pin (this is the repin cost; ordinary runs skip it)"

# Cleared before rather than rewritten after: between here and the last line of
# this script the tree is somewhere between two pins, and nothing that reads
# this file may be told otherwise if the machine goes away in the middle.
rm -f "$STAMP"

# The sentinel, for the reason `engine-build.sh` has one. Chromium's toolchain
# shell is upstream's buildFHSEnv, whose shellHook execs bwrap, and a command
# run through NIX_SHELL_RUN does not reliably carry its exit status back out —
# this repository has three steps written around that. A file the inner script
# touches as its last act is the one thing that distinguishes a sync that ran
# from a shell that ran nothing.
#
# Under $TMPDIR, which on the runner is /build/tmp: bwrap leaves /build visible
# at the same path, so the inner script's `touch` lands where this can see it.
SENTINEL="$(mktemp -u "${TMPDIR:-/tmp}/domicile-sync.XXXXXX")"
rm -f "$SENTINEL"

# `nix-shell` rather than nix-ld: depot_tools fetches prebuilt,
# dynamically-linked binaries and runs them, and on NixOS they do not start
# against the store unaided. Upstream's own shell is the environment that
# works, and it is already how everything else in this tree is built on this
# runner. `--command` does not work with it — nix appends its `exec` after the
# shellHook that never returns — so NIX_SHELL_RUN is upstream's escape hatch,
# and it takes a path to a script rather than a composed command because the
# quoting otherwise passes through three shells.
NIX_SHELL_RUN="$ROOT/.github/scripts/engine-sync-deps.sh $CHROMIUM $pin $SENTINEL" \
  nix-shell "$CHROMIUM/tools/nix/shell.nix"

[ -e "$SENTINEL" ] || {
  echo "::error::the sync did not run: $CHROMIUM/tools/nix/shell.nix returned without reaching engine-sync-deps.sh" >&2
  echo "That shell is a buildFHSEnv whose shellHook execs bwrap, so it can exit 0" >&2
  echo "having run nothing at all. The sentinel is what catches it." >&2
  exit 1
}
rm -f "$SENTINEL"

# A `.gclient` whose solution is `managed` — which is what an older
# depot_tools wrote — syncs the solution itself to the head of its branch, and
# the series applies to the pin and to nothing else. `--revision` is passed for
# that reason and this asserts it held, because a sync that quietly moved the
# tree would be caught three steps later by `apply.sh` saying a patch did not
# apply, which reads as the series rotting rather than as this.
head="$(git -C "$CHROMIUM" rev-parse HEAD)"
[ "$head" = "$pin" ] || {
  echo "::error::the sync moved $CHROMIUM off the pin" >&2
  echo "  the series is against $pin" >&2
  echo "  the checkout is now at $head" >&2
  echo "A solution marked \`managed\` in $(dirname "$CHROMIUM")/.gclient does this." >&2
  exit 1
}

printf '%s\n' "$pin" >"$STAMP"
echo "DEPS are at $pin"
