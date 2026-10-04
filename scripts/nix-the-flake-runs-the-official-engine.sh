#!/usr/bin/env bash
# Checks `nix build .#engine` picks the official engine of this series when
# pinned, and the checked engine otherwise.
#
# Each series has a checked build (DCHECKs, no PGO) from the pull request and
# an official build (PGO, ThinLTO) from engine-release.yml, hours after merge.
# Until the official build lands, its pin points at the previous series, which
# lacks the new patches. So `engine-pin.nix` takes the official engine only
# when its identity matches the checked one. See
# packages/domicile-engine/docs/RELEASES.md.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

pick() { # checked identity, official identity or "none"
  local official=null
  [ "$2" = none ] || official="{ identity = \"$2\"; url = \"official\"; }"
  nix eval --raw --impure --expr "
    (import ./packages/domicile-engine/engine-pin.nix {
      checked = { identity = \"$1\"; url = \"checked\"; };
      official = $official;
    }).url"
}

[ "$(pick aaaa aaaa)" = official ] || {
  echo "an official engine of this series was not picked" >&2
  exit 1
}
[ "$(pick aaaa bbbb)" = checked ] || {
  echo "an official engine of another series was picked over this series' own" >&2
  exit 1
}
[ "$(pick aaaa none)" = checked ] || {
  echo "with no official engine pinned, the checked one was not picked" >&2
  exit 1
}

# Check the flake uses `engine-pin.nix` with the checked-in pin files.
want="$(nix eval --raw --impure --expr '
  let
    official = ./packages/domicile-engine/engine-official.nix;
  in (import ./packages/domicile-engine/engine-pin.nix {
    checked = import ./packages/domicile-engine/engine-release.nix;
    official = if builtins.pathExists official then import official else null;
  }).url')"
got="$(nix eval --raw '.#engine.src.urls' --apply builtins.head)"
[ "$got" = "$want" ] || {
  echo "the flake's engine fetches $got, where engine-pin.nix picks $want" >&2
  exit 1
}
echo "the flake's engine is $got"
