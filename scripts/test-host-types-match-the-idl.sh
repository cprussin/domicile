#!/usr/bin/env bash
# Checks that the SDK's `domicile-host.ts` is what the engine's WebIDL
# generates.
#
# The file is generated and checked in, so an IDL change that is not
# regenerated leaves shells typed against an engine that no longer exists.
# Fix with `bun run generate` in `packages/chrome-sdk`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$ROOT/packages/chrome-sdk"
CHECKED_IN="$SDK/src/domicile-host.ts"
[ -f "$CHECKED_IN" ] || { echo "no $CHECKED_IN" >&2; exit 1; }
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to run the generator with"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! bun "$SDK/codegen/generate-domicile-host.ts" "$WORK/domicile-host.ts"; then
  echo "  FAIL  the generator runs"
  exit 1
fi
if diff -u "$CHECKED_IN" "$WORK/domicile-host.ts"; then
  echo "  ok    domicile-host.ts is what the IDL generates"
  echo "all ok"
else
  echo "  FAIL  domicile-host.ts is what the IDL generates"
  echo "    run \`bun run generate\` in packages/chrome-sdk"
  exit 1
fi
