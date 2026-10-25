#!/usr/bin/env bash
# Checks that both engine builds import every arguments file under
# `src/build/args/`.
#
# `packages/domicile-engine/scripts/build.sh` (measurements) and
# `.github/scripts/engine-release-build.sh` (releases) each carry their own
# `gn gen` arguments. A file one of them forgets makes the two builds differ:
# the release ships what the measurements never ran, or the reverse.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ARGS="$ROOT/packages/domicile-engine/src/build/args"
BUILDS="$ROOT/packages/domicile-engine/scripts/build.sh
$ROOT/.github/scripts/engine-release-build.sh"

FILES="$(cd "$ARGS" && ls -- *.gn 2>/dev/null)"
[ -n "$FILES" ] || { echo "no arguments files in $ARGS" >&2; exit 1; }

FAILED=0
for file in $FILES; do
  for build in $BUILDS; do
    [ -f "$build" ] || { echo "no build script at $build" >&2; exit 1; }
    if grep -qF "import(\\\"//build/args/$file\\\")" "$build"; then
      printf '  ok    %s imports %s\n' "${build#"$ROOT"/}" "$file"
    else
      printf '  FAIL  %s does not import %s\n' "${build#"$ROOT"/}" "$file"
      FAILED=$((FAILED + 1))
    fi
  done
done
[ "$FAILED" -eq 0 ] || exit 1
echo "all ok"
