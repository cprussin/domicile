#!/usr/bin/env bash
# That `nix build .#engine` is the production engine whenever there is one of
# this series, and the checked engine otherwise.
#
# Two engines are published per series: the CHECKED build a pull request
# proves (DCHECKs on, no PGO), and the OFFICIAL build engine-release.yml makes
# after the merge (PGO, ThinLTO, no DCHECKs). Users should run the second. But
# it arrives hours after the merge, so between the two a pin to it would be a
# pin to the previous series' engine: the fork's new patches missing from the
# desktop, and nothing saying so.
#
# So both are pinned, and `engine-pin.nix` takes the official one only when its
# identity is the checked one's -- which is the identity
# `test-the-pinned-engine-is-this-series.sh` holds to the fork in the tree.
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

# And that the flake asks it, about the two files it actually has.
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
