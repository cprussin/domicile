# Which published engine `nix build .#engine` produces.
#
# A fixed-output derivation needs a hash, and a hash pins a build — which is
# the point rather than a cost. `engine-nightly` is a rolling tag: without this
# file the same flake revision would fetch a different engine on different days
# and a bug reported against it could not be reproduced. With it, a flake
# revision names exactly one engine, and moving to a new one is a commit
# somebody can look at.
#
# Regenerate with `scripts/update-engine-release.sh` after a release publishes.
{
  commit = "4a010ae75a516cc604596923d9e593d7ced8f683";
  url =
    "https://github.com/cprussin/domicile/releases/download/engine-nightly/domicile-engine-4a010ae-linux-x64.tar.zst";
  hash = "sha256-GesE4WvTiRzGlyWN3hUX1GQuLFNnh0oeNZZdKNKGi1Q=";
}
