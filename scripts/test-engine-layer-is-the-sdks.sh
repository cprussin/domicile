#!/usr/bin/env bash
# Checks that the engine's `domicile_layer.js` is what the SDK's
# `src/desktop/layer.ts` bundles to.
#
# The engine evaluates the file to build the `Domicile` it hands a shell and
# the `AppDomicile` it hands an app, so an SDK change that is not regenerated
# hands every module an object that no longer matches its types. Fix with
# `bun run generate` in `packages/chrome-sdk`, which is an engine change.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="$ROOT/packages/chrome-sdk"
CHECKED_IN="$ROOT/packages/domicile-engine/src/third_party/blink/renderer/modules/domicile/domicile_layer.js"
[ -f "$CHECKED_IN" ] || { echo "no $CHECKED_IN" >&2; exit 1; }
command -v bun >/dev/null 2>&1 || {
  echo "SKIP: no bun to bundle the layer with"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! bun "$SDK/codegen/generate-engine-layer.ts" "$WORK/domicile_layer.js"; then
  echo "  FAIL  the generator runs"
  exit 1
fi
if cmp -s "$CHECKED_IN" "$WORK/domicile_layer.js"; then
  echo "  ok    domicile_layer.js is what the SDK bundles"
  echo "all ok"
else
  echo "  FAIL  domicile_layer.js is what the SDK bundles"
  echo "    run \`bun run generate\` in packages/chrome-sdk"
  exit 1
fi
