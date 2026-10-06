#!/usr/bin/env bash
# Put the shared checkout's DEPS at the pin, so a repin needs nobody on `crux`.
#
#   .github/scripts/engine-sync.sh /build/chromium/src
#
# `engine-reset.sh` moves the Chromium commit; this moves the third-party deps
# (toolchain, sysroots, everything in DEPS) to match. See
# packages/domicile-engine/docs/BUILD-MACHINE.md#moving-the-pin.
#
# - Run after the reset and before `apply.sh`. gclient needs a clean tree at the
#   pin, and `apply.sh` refuses the dirty tree a sync leaves.
# - A sync takes minutes, so the last synced pin is stamped beside the checkout
#   and a matching run skips gclient.
# - The stamp is written only after a sync finishes with the tree still at the
#   pin. A stamp on a half-synced tree would let the next run build against a
#   mix of two pins without any error.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || { echo "usage: $(basename "$0") <chromium checkout>" >&2; exit 2; }

pin="$(grep -v '^#' "$ROOT/packages/domicile-engine/CHROMIUM_PIN" | tr -d '[:space:]')"

# Outside `src/`: an untracked file there makes the tree dirty, and `apply.sh`
# refuses a dirty tree. Tests override it because they have no /build.
STAMP="${DOMICILE_SYNCED_PIN:-$(dirname "$CHROMIUM")/.domicile-synced-pin}"

if [ "$(cat "$STAMP" 2>/dev/null || true)" = "$pin" ]; then
  echo "DEPS are already at $pin"
  exit 0
fi

echo "syncing DEPS to $pin (this is the repin cost; ordinary runs skip it)"

# Cleared first: the tree is between two pins until the sync finishes, and an
# interrupted run must not leave a stamp claiming either.
rm -f "$STAMP"

# Chromium's toolchain shell is a buildFHSEnv whose shellHook execs bwrap, so
# NIX_SHELL_RUN does not reliably return the command's exit status. The inner
# script touches this sentinel as its last step instead.
#
# Under $TMPDIR (/build/tmp on the runner), which bwrap exposes at the same
# path.
SENTINEL="$(mktemp -u "${TMPDIR:-/tmp}/domicile-sync.XXXXXX")"
rm -f "$SENTINEL"

# Upstream's shell runs the prebuilt binaries depot_tools fetches, which do not
# start on NixOS unaided. `--command` does not work because the shellHook never
# returns, so this uses upstream's NIX_SHELL_RUN with a script path.
NIX_SHELL_RUN="$ROOT/.github/scripts/engine-sync-deps.sh $CHROMIUM $pin $SENTINEL" \
  nix-shell "$CHROMIUM/tools/nix/shell.nix"

[ -e "$SENTINEL" ] || {
  echo "::error::the sync did not run: $CHROMIUM/tools/nix/shell.nix returned without reaching engine-sync-deps.sh" >&2
  echo "That shell is a buildFHSEnv whose shellHook execs bwrap, so it can exit 0" >&2
  echo "having run nothing at all. The sentinel is what catches it." >&2
  exit 1
}
rm -f "$SENTINEL"

# A `managed` solution in `.gclient` syncs to its branch head. `--revision`
# prevents that; this check catches it here instead of as a confusing patch
# failure in `apply.sh`.
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
