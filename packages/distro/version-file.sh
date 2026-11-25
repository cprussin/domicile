#!/usr/bin/env bash
# Prints `libexec/domicile/version`, what `domicile --version` prints first.
#
#   packages/distro/version-file.sh <workspace> <rev>
#
# - <workspace>: a checkout of <rev>.
# - <rev>: a full commit hash, or a flake's `dirtyRev` (`<hash>-dirty`).
# - With `DOMICILE_RELEASE=1`, the first line is the version changesets gave
#   `domicile`. Otherwise it is the channel and the short commit: `stable` when
#   the commit runs the official engine, as `.github/scripts/promote-stable.sh`
#   decides, else `main`.
# - The second line is the full commit.
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: version-file.sh <workspace> <rev>" >&2
  exit 2
}
WORKSPACE="$1"
REV="$2"
[[ "$REV" =~ ^([0-9a-f]{40})(-dirty)?$ ]] || {
  echo "version-file.sh: $REV is not a full commit hash" >&2
  exit 2
}
SHORT="${BASH_REMATCH[1]:0:12}${BASH_REMATCH[2]}"
ENGINE="$WORKSPACE/packages/domicile-engine"

# The series a pin file names. Fails on a missing file or no identity.
identity_of() { # pin file
  local identity
  identity="$(sed -n 's/^ *identity = "\([0-9a-f]*\)";.*/\1/p' "$1" | head -1)"
  [ -n "$identity" ] || {
    echo "version-file.sh: $1 names no identity" >&2
    exit 1
  }
  echo "$identity"
}

if [ "${DOMICILE_RELEASE:-}" = 1 ]; then
  first="$(jq -er .version "$WORKSPACE/packages/domicile/package.json")"
else
  checked="$(identity_of "$ENGINE/engine-release.nix")"
  channel=main
  if [ -f "$ENGINE/engine-official.nix" ] &&
    [ "$(identity_of "$ENGINE/engine-official.nix")" = "$checked" ]; then
    channel=stable
  fi
  first="$channel $SHORT"
fi
printf 'domicile %s\ncommit   %s\n' "$first" "$REV"
