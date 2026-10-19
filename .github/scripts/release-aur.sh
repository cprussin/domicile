#!/usr/bin/env bash
# Publishes `domicile-bin` to the AUR for a release's Arch package.
#
#   AUR_SSH_KEY=<private key> .github/scripts/release-aur.sh <package> <repository url>
#
# Commits `distro/aur.sh`'s files to the AUR's git repository and pushes. A
# package the AUR already has commits nothing. `DOMICILE_RELEASE_DRY_RUN=1`
# shows the change and pushes nothing. `DOMICILE_AUR_REMOTE` replaces the
# AUR's repository.
#
# - <package>: the Arch package as published, whose checksum the PKGBUILD
#   names.
# - <repository url>: where `distro/repo.sh`'s repositories are served.
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: release-aur.sh <package> <repository url>" >&2
  exit 2
}
PACKAGE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
URL="$2"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTE="${DOMICILE_AUR_REMOTE:-ssh://aur@aur.archlinux.org/domicile-bin.git}"
# The AUR's host key, as https://aur.archlinux.org lists it.
AUR_HOST_KEY=SHA256:RFzBCUItH9LZS0cKB5UE6ceAYhBD5C8GeOBip8Z11+4

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if [ -n "${AUR_SSH_KEY:-}" ]; then
  (umask 077 && printf '%s\n' "$AUR_SSH_KEY" >"$WORK/key")
  ssh-keyscan -q -t ed25519 aur.archlinux.org >"$WORK/known_hosts"
  scanned="$(ssh-keygen -lf "$WORK/known_hosts" | awk '{print $2}')"
  [ "$scanned" = "$AUR_HOST_KEY" ] || {
    echo "release-aur.sh: aur.archlinux.org offered host key $scanned, not $AUR_HOST_KEY" >&2
    exit 1
  }
  export GIT_SSH_COMMAND="ssh -i $WORK/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$WORK/known_hosts -o StrictHostKeyChecking=yes"
fi

git clone -q "$REMOTE" "$WORK/aur"
"$ROOT/distro/aur.sh" "$PACKAGE" "$URL" "$WORK/aur"
git -C "$WORK/aur" add -A
if git -C "$WORK/aur" diff --cached --quiet; then
  echo "the AUR has this domicile-bin already"
  exit 0
fi

version="$(sed -n 's/^\tpkgver = //p' "$WORK/aur/.SRCINFO")-$(sed -n 's/^\tpkgrel = //p' "$WORK/aur/.SRCINFO")"
if [ "${DOMICILE_RELEASE_DRY_RUN:-}" = 1 ]; then
  echo "dry run: domicile-bin $version would change"
  git -C "$WORK/aur" diff --cached --stat
  exit 0
fi
git -C "$WORK/aur" commit -qm "domicile-bin $version"
git -C "$WORK/aur" push -q origin HEAD:master
echo "the AUR has domicile-bin $version"
