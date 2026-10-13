#!/usr/bin/env bash
# Checks the flake's shell builder ships only its production workspace, and
# still builds a shell from an entry.
#
# `shellWorkspace` is in every desktop's closure, so a development dependency,
# test or source map in it costs each install. `distro/shell-workspace.sh`
# prunes it; `scripts/test-distro-stage.sh` covers the pruning in detail.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

builder="$(nix build --no-link --print-out-paths .#builder)"
workspace="$(sed -n 's/.*--domicile \([^ ]*\).*/\1/p' "$builder")"
[ -d "$workspace/packages" ] || {
  echo "the builder names no workspace: $(cat "$builder")" >&2
  exit 1
}

FAILED=0
shipped() { # what, find arguments
  local what="$1" found
  shift
  found="$(cd "$workspace" && find . "$@" -print -quit)"
  [ -z "$found" ] || {
    echo "  FAIL  $what: $found" >&2
    FAILED=$((FAILED + 1))
  }
}
shipped "a development dependency" -path './node_modules/.bun/storybook@*'
shipped "a test" -path './packages/*/src/*' -name '*.test.ts*'
shipped "a source map" -name '*.map'
shipped "a module's readme" -path './node_modules/*' -iname 'README*'
shipped "a musl native module" -path './node_modules/.bun/*-musl@*'
shipped "a package the builder does not link" -path ./packages/test-support/src

# As `domicile` builds a config's shell.
desk="$(mktemp -d)"
trap 'rm -rf "$desk"' EXIT
cat >"$desk/domicile.tsx" <<'EOF'
import { runManganese } from "@domicile-desktop/manganese";
export const Shell = runManganese();
EOF
built="$("$builder" --entry "$desk/domicile.tsx" --cache "$desk/cache" 2>&1)" || {
  echo "  FAIL  the builder failed: $built" >&2
  exit 1
}
root="$(echo "$built" | sed -n 's/.*"root":"\([^"]*\)".*"step":"built".*/\1/p')"
[ -n "$root" ] && [ -f "$root/shell.js" ] || {
  echo "  FAIL  the builder built no shell: $built" >&2
  FAILED=$((FAILED + 1))
}

[ "$FAILED" -eq 0 ] || exit 1
echo "the builder ships its production workspace and builds a shell"
