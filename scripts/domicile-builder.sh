#!/usr/bin/env bash
# Shell builder for running `domicile` from this checkout instead of an
# install.
#
#   DOMICILE_BUILDER="$PWD/scripts/domicile-builder.sh" domicile ./my-desk.tsx
#
# The checkout has the same layout as an install, so it is the `--domicile`
# root the builder resolves manganese and React from. Run `bun install` and
# `bunx turbo run prepare build` first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bun "$ROOT/packages/domicile-builder/src/main.ts" --domicile "$ROOT" "$@"
