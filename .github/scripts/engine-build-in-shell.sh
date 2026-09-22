#!/usr/bin/env bash
# Build the engine inside Chromium's own toolchain shell, and prove it ran.
#
#   .github/scripts/engine-build-in-shell.sh <path to chromium/src>
#
# TWO SHELLS, AND WHICH ONE IS NEEDED IS NOT A DETAIL. Chromium's own toolchain
# shell (`$CHROMIUM/tools/nix`) supplies the host tools `gn` probes for, and
# applying and building need it. Domicile's full shell (`.#full`) is what the
# guards need, and it is not a superset: `engineRuntimeLibs` in flake.nix puts
# Chromium's runtime libraries beside the GL stack, and a guard needs both. The
# GL stack, or no client can hand the compositor a dmabuf at all; Chromium's, or
# libdomicile_engine.so will not load.
#
# `--command` does not work with Chromium's shell: upstream's is a buildFHSEnv
# whose shellHook execs bwrap before nix's appended `exec` is reached, so you
# land in an interactive bash having run nothing. `NIX_SHELL_RUN` is upstream's
# own escape hatch for scripting it. See cprussin/dotfiles chromium-build.nix,
# which measured all of this.
#
# THE SHELL HAS TO PROVE IT RAN THE COMMAND. `NIX_SHELL_RUN` was measured
# working — by a person, at a terminal. In CI this returned success in one
# second, which is not a Chromium build of any kind. A shell that silently runs
# nothing is the same failure as the apply step, one layer along. So the command
# writes a sentinel and this checks for it; whichever path worked,
# `scripts/engine-build-produced-what-the-guards-load.sh` is still the thing
# that decides.
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

# `<nixpkgs>` has to resolve or the shell builds nothing: tools/nix/shell.nix
# imports it, and a systemd service has no NIX_PATH — that is something NixOS
# arranges for an interactive user, and the runner unit is not one. Without it
# nix-shell says "uses bash from your environment" and hands the script an
# ambient shell with no toolchain in it.
#
# From the flake registry rather than written down, because the registry is what
# pins nixpkgs on this machine and a second copy of that pin here would be a
# second thing to keep true.
nixpkgs="$(nix eval --raw --impure --expr '(builtins.getFlake "nixpkgs").outPath')"
echo "nixpkgs is $nixpkgs"
export NIX_PATH="nixpkgs=$nixpkgs"

# `nix-shell` with the shell.nix, which is the form under-wayland.sh and the
# guards use and the only one that has ever run on this machine. `nix develop
# path:` wants a flake.nix and this directory ships a shell.nix; it entered
# nothing and exited 0, which was indistinguishable from success until the
# sentinel existed.
#
# A path, not a command: everything in NIX_SHELL_RUN is re-quoted twice on its
# way in.
if NIX_SHELL_RUN="$ROOT/.github/scripts/engine-build.sh $CHROMIUM $DONE" \
     nix-shell "$CHROMIUM/tools/nix/shell.nix" >"$LOG" 2>&1; then
  echo "the shell exited 0"
else
  echo "the shell exited $?"
fi

# A compiler error is *above* siso's summary, never in it: the summary says how
# many steps failed and not which line of which file. Twenty-five lines caught
# the tail of the progress spinner and the resource table, so a build failure
# cost a whole cycle on the shared tree to learn nothing.
#
# The diagnostics first, so they are at the top of the group whatever the tail
# holds, then the tail for context. `|| true` because grep finding nothing is
# not this script's failure; the build already failed and `set -e` would
# swallow the tail below.
grep -aE 'error:|FAILED:|ninja: build stopped|Error:' "$LOG" |
  tail -40 | sed 's/^/  E /' || true
tail -120 "$LOG" | sed 's/^/  | /'

[ -e "$DONE" ] || {
  echo "::error::Chromium's shell did not run the build; its last words are above" >&2
  exit 1
}
