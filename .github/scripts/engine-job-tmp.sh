#!/usr/bin/env bash
# Make or remove a per-job temp directory, so files nix leaves behind go with
# the job.
#
#   .github/scripts/engine-job-tmp.sh make          # prints the new directory
#   .github/scripts/engine-job-tmp.sh drop <dir>
#
# Each nix shell makes `$TMPDIR/nix-shell.XXXXXX`, points TMPDIR at it, and
# never removes it: `nix develop` has no cleanup, and in Chromium's FHS shell
# bwrap replaces the bash that holds nix-shell's cleanup trap. Each one holds
# about 1.2G of build output.
#
# Each job makes one of these, sets it as TMPDIR through $GITHUB_ENV, and drops
# it in an `if: always()` step. engine-release-room.sh removes those of jobs the
# runner lost. Tested by scripts/test-engine-job-tmp.sh.
set -euo pipefail

usage() {
  echo "usage: $(basename "$0") make | drop <dir>" >&2
  exit 2
}

case "${1:-}" in
  make)
    # Short, because Chrome's singleton socket path must fit in 107 bytes.
    # The CSS guard nests two nix shells and still overflows, so spike.sh
    # gives Chrome TMPDIR=/tmp.
    mktemp -d "${TMPDIR:-/tmp}/dj.XXXXXX"
    ;;
  drop)
    dir="${2:-}"
    [ -n "$dir" ] || usage
    # The path came through $GITHUB_ENV, so refuse anything `make` did not
    # create before running `rm -rf`.
    case "$(basename "$dir")" in
      dj.*) ;;
      *)
        echo "::error::$dir is not a job's temp directory; not removing it" >&2
        exit 1
        ;;
    esac
    # Files copied from the nix store are read-only, which stops `rm -rf`.
    chmod -R u+w "$dir"
    rm -rf "$dir"
    ;;
  *)
    usage
    ;;
esac
