#!/usr/bin/env bash
# Prints the version the distribution packages carry.
#
#   distro/version.sh <workspace>
#
# - By default, `0.<date>.<time>` of <workspace>'s commit, in UTC, so later
#   commits sort later in every format.
# - With `DOMICILE_RELEASE=1`, the version changesets gave `domicile`, the
#   distribution package's manifest.
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: version.sh <workspace>" >&2
  exit 2
}

if [ "${DOMICILE_RELEASE:-}" = 1 ]; then
  jq -r .version "$1/packages/domicile/package.json"
else
  echo "0.$(TZ=UTC git -C "$1" log -1 --format=%cd --date=format-local:%Y%m%d.%H%M%S)"
fi
