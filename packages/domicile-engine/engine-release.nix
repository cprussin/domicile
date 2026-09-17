# Which published engine `nix build .#engine` produces.
#
# THIS BRANCH IS A TEST FIXTURE AND MUST NEVER BE MERGED. It pins
# `engine-nightly`, which the header below explains is exactly the wrong thing
# to pin: that release is deleted and recreated on every release run, so this
# stops resolving the moment the next build lands. It exists because run
# 35260586435 put a good engine on the nightly and then hung before it could
# put the same file on its immutable tag, and a desktop nobody can start is a
# worse problem than a pin nobody should keep.
#
# The hash is the one thing here that is not provisional. It was checked three
# ways against the published artifact: GitHub's recorded asset digest, the
# `.sha256` published beside the tarball, and a sha256sum of the 216,827,476
# byte download.
#
# A fixed-output derivation needs a hash, and a hash pins a build — which is
# the point rather than a cost. Without this file the same flake revision would
# fetch a different engine on different days, and a bug reported against one
# could not be reproduced. With it, a flake revision names exactly one engine,
# and moving to a new one is a commit somebody can look at.
{
  commit = "2ab8cb443382b2ae80e6dd7e0c9dd9755e05d157";
  url = "https://github.com/cprussin/domicile/releases/download/engine-nightly/domicile-engine-2ab8cb4-linux-x64.tar.zst";
  hash = "sha256-Z1jYnmu6v5S6ioJBp9U2iHjfyB62cItpRmi3Yf9WElc=";
}
