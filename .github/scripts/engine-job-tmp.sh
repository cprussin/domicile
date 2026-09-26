#!/usr/bin/env bash
# A temp directory per job, so what nix leaks leaves with the job.
#
#   .github/scripts/engine-job-tmp.sh make          # prints the new directory
#   .github/scripts/engine-job-tmp.sh drop <dir>
#
# WHY NIX LEAKS ON THESE RUNNERS. Both ways into a nix shell make a
# `$TMPDIR/nix-shell.XXXXXX`, point TMPDIR inside the shell at it, and leave it:
#
#   nix develop   its rc script is `export NIX_BUILD_TOP="$(mktemp -d -t
#                 nix-shell.XXXXXX)"` and TMPDIR=$NIX_BUILD_TOP, then `exec`s
#                 the command. Nothing in nix ever removes that directory.
#   nix-shell     removes its own from `trap _nix_shell_clean_tmpdir EXIT` in
#                 the rc bash. Chromium's tools/nix/shell.nix is a buildFHSEnv
#                 whose shellHook `exec`s bwrap, which replaces that bash, so
#                 the trap never runs — whether the build passes or not.
#
# And since TMPDIR inside is that directory, everything a build or a guard
# wrote to TMPDIR stays in it: ~1.2G each, ~70 of them, 82G of /build/tmp.
#
# So each job makes one of these under the unit's TMPDIR (/build/tmp), writes
# it to $GITHUB_ENV as TMPDIR for every later step, and drops it in an
# `if: always()` step. A job the runner itself lost never reaches that step;
# engine-release-room.sh reclaims those once they are older than any job.
# See scripts/test-engine-job-tmp.sh.
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") make | drop <dir>" >&2
  exit 2
}

case "${1:-}" in
  make)
    # Short, because paths under TMPDIR can have a byte limit: Chrome's
    # singleton socket must fit 107. Under the CSS guard's two nested nix
    # shells no name here leaves room, so spike.sh gives Chrome TMPDIR=/tmp.
    mktemp -d "${TMPDIR:-/tmp}/dj.XXXXXX"
    ;;
  drop)
    dir="${2:-}"
    [ -n "$dir" ] || usage
    # An `rm -rf` of a path that came through $GITHUB_ENV. Anything but a
    # directory `make` made is a bug upstream of here, so it is refused.
    case "$(basename "$dir")" in
      dj.*) ;;
      *)
        echo "::error::$dir is not a job's temp directory; not removing it" >&2
        exit 1
        ;;
    esac
    # Writable first: a copy out of the nix store keeps the store's read-only
    # modes, and `rm -rf` stops at the first directory it cannot write into.
    chmod -R u+w "$dir"
    rm -rf "$dir"
    ;;
  *)
    usage
    ;;
esac
