#!/usr/bin/env bash
# Build the engine inside Chromium's own toolchain shell, and prove it ran.
#
#   .github/scripts/engine-build-in-shell.sh <path to chromium/src>
#
# The build needs Chromium's toolchain shell (`$CHROMIUM/tools/nix`) for the
# host tools `gn` probes for. The guards use Domicile's `.#full` shell instead.
#
# `--command` does not work here: the shell is a buildFHSEnv whose shellHook
# execs bwrap, so nix never runs the command. `NIX_SHELL_RUN` is upstream's
# way to script it.
#
# The shell can exit 0 without running anything, so the build writes a sentinel
# and this checks for it.
# `scripts/engine-build-produced-what-the-guards-load.sh` checks the output.
set -euo pipefail

CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || {
  echo "usage: engine-build-in-shell.sh <path to chromium/src>" >&2
  exit 2
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DONE=/tmp/domicile-build-ran
LOG=/tmp/domicile-shell.log
rm -f "$DONE"

# tools/nix/shell.nix imports `<nixpkgs>`, and the runner's systemd unit has
# no NIX_PATH. Without it nix-shell runs the script with no toolchain. Read it
# from the flake registry so this machine's nixpkgs pin stays in one place.
nixpkgs="$(nix eval --raw --impure --expr '(builtins.getFlake "nixpkgs").outPath')"
echo "nixpkgs is $nixpkgs"
export NIX_PATH="nixpkgs=$nixpkgs"

# `nix-shell`, not `nix develop`: the directory has a shell.nix and no
# flake.nix. NIX_SHELL_RUN gets a script path because its contents are
# re-quoted twice.
if NIX_SHELL_RUN="$ROOT/.github/scripts/engine-build.sh $CHROMIUM $DONE" \
     nix-shell "$CHROMIUM/tools/nix/shell.nix" >"$LOG" 2>&1; then
  echo "the shell exited 0"
else
  echo "the shell exited $?"
fi

# siso's summary omits the compiler errors, so print matching lines first, then
# the tail for context. `|| true` so a grep with no match does not skip the
# tail.
grep -aE 'error:|FAILED:|ninja: build stopped|Error:' "$LOG" |
  tail -40 | sed 's/^/  E /' || true
tail -120 "$LOG" | sed 's/^/  | /'

[ -e "$DONE" ] || {
  echo "::error::Chromium's shell did not run the build; its last words are above" >&2
  exit 1
}
