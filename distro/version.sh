#!/usr/bin/env bash
# Prints the version the distribution packages carry.
#
#   distro/version.sh <workspace> [arch]
#
# - By default, `0.<date>.<time>` of <workspace>'s commit, in UTC, so later
#   commits sort later in every format.
# - With `DOMICILE_RELEASE=1`, the version changesets gave `domicile`, the
#   distribution package's manifest.
# - With `DOMICILE_PRERELEASE=1`, that version as a prerelease of the commit:
#   `<version>~pre.<date>.<time>`, which apt and rpm sort before `<version>`.
# - `arch` prints it for pacman, which sorts `~` after the release: it drops
#   the `~`, and pacman sorts the letters after the number before it.
set -euo pipefail

[ "$#" -eq 1 ] || { [ "$#" -eq 2 ] && [ "$2" = arch ]; } || {
  echo "usage: version.sh <workspace> [arch]" >&2
  exit 2
}

time="$(TZ=UTC git -C "$1" log -1 --format=%cd --date=format-local:%Y%m%d.%H%M%S)"
if [ "${DOMICILE_PRERELEASE:-}" = 1 ]; then
  version="$(jq -r .version "$1/packages/domicile/package.json")~pre.$time"
elif [ "${DOMICILE_RELEASE:-}" = 1 ]; then
  version="$(jq -r .version "$1/packages/domicile/package.json")"
else
  version="0.$time"
fi
[ "$#" -eq 1 ] || version="${version//\~/}"
echo "$version"
