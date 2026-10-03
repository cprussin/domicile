#!/usr/bin/env bash
# The shell builder for a checkout: what `DOMICILE_BUILDER` names when
# `domicile` runs out of this tree rather than an install.
#
#   DOMICILE_BUILDER="$PWD/scripts/domicile-builder.sh" domicile ./my-desk.tsx
#
# This checkout is laid out as Domicile's install is, so it is the
# `--domicile` the builder resolves manganese and React from. Run
# `bun install` and `bunx turbo run prepare build` first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bun "$ROOT/packages/domicile-builder/src/main.ts" --domicile "$ROOT" "$@"
