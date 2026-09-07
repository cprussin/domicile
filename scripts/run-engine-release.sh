#!/usr/bin/env bash
# A Domicile desktop on the engine CI published, with no Chromium checkout.
#
#   nix run github:cprussin/domicile#engine -- manganese
#
# The counterpart of `run-engine.sh`, which takes a path to a Chromium checkout
# you built yourself. There is still one way to run a desktop on the fork; this
# only answers the question of where the engine came from.
#
# It is this short because the flake's `engine` package has already done all of
# it: `fetchurl` fetched and verified the release against the hash in
# `packages/domicile-engine/engine-release.nix`, the store is the cache,
# `autoPatchelfHook` rewrote the interpreter and rpath so a generic-linux
# Chromium starts on NixOS at all, and the derivation's install check has
# already run `chrome --version`. An earlier version of this did every one of
# those by hand, in shell, worse.
#
# `OUT=.` because a published build *is* the out directory: the package has
# `chrome` and `libdomicile_engine.so` at its top, where a Chromium checkout
# has them under `out/Domicile`, and `run-engine.sh` only ever joins
# `$CHROMIUM/$OUT` to find those two.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${DOMICILE_ENGINE:-}" ]; then
  echo "run-engine-release.sh: DOMICILE_ENGINE is not set, so there is no" >&2
  echo "  engine to run. The flake sets it — use \`nix run .#engine\`, or set" >&2
  echo "  it yourself to the output of \`nix build .#engine\`." >&2
  exit 1
fi

OUT=. exec "$ROOT/scripts/run-engine.sh" "$DOMICILE_ENGINE" "$@"
