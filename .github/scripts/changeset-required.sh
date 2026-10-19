#!/usr/bin/env bash
# Fails when this branch changes a workspace package without a changeset.
#
#   .github/scripts/changeset-required.sh <base>
#
# <base> is the branch it merges into. A change that releases nothing adds an
# empty changeset: `bun changeset --empty`.
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: changeset-required.sh <base>" >&2
  exit 2
}

exec node_modules/.bin/changeset status --since="$1"
