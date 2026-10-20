#!/usr/bin/env bash
# Tests that every package's `engines` is the root `package.json`'s.
#
# The root's `engines` is what `nix-the-flake-ships-the-bun-package-json-asks-for.sh`
# holds the flake to, so a package asking for anything else drifts from it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

wanted="$(jq -c '.engines' package.json)"
[ "$wanted" != null ] || { echo "the root package.json has no engines" >&2; exit 1; }

echo "every package asks for $wanted"
for manifest in packages/*/package.json examples/*/package.json; do
  engines="$(jq -c '.engines' "$manifest")"
  if [ "$engines" = "$wanted" ]; then
    ok "$manifest"
  else
    fail "$manifest" "asks for $engines"
  fi
done

[ "$FAILED" -eq 0 ]
