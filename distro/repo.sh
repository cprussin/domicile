#!/usr/bin/env bash
# Adds the distribution packages `distro/build.sh` made to the apt, rpm and
# pacman repositories, then indexes and signs them.
#
#   DOMICILE_SIGNING_KEY=<armored secret key> distro/repo.sh <packages> <repo>
#
# - <packages>: `distro/build.sh`'s output.
# - <repo>: the repositories, as published; created if missing. Updated in
#   place, so a release syncs it down, runs this and syncs it back up.
# - The tools in `distro/repo-tools` must be on PATH.
#
# Layout under <repo>, all signed by the key in `domicile.asc`:
#
#   domicile.asc                     the public key
#   apt/dists/current, apt/pool/current   Debian 13+, Ubuntu 24.04+
#   apt/dists/legacy, apt/pool/legacy     Debian 12, Ubuntu 22.04
#   rpm/fedora, rpm/opensuse         signed packages and `repodata/`
#   arch/x86_64                      packages, their `.sig`s and `domicile.db`
#
# The repositories keep the three newest versions, so a release downloads and
# uploads a bounded amount. A version they already hold is kept as published,
# so a rerun of a release changes nothing it already published.
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: repo.sh <packages> <repo>" >&2
  exit 2
}
PACKAGES="$(cd "$1" && pwd)"
mkdir -p "$2"
REPO="$(cd "$2" && pwd)"
: "${DOMICILE_SIGNING_KEY:?repo.sh: DOMICILE_SIGNING_KEY is unset}"

GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'gpgconf --kill all; rm -rf "$GNUPGHOME"' EXIT
gpg --batch --quiet --import <<<"$DOMICILE_SIGNING_KEY"
mapfile -t KEYS < <(gpg --batch --with-colons --list-secret-keys | awk -F: '/^sec/ {key = 1} key && /^fpr/ {print $10; key = 0}')
[ "${#KEYS[@]}" -eq 1 ] || {
  echo "repo.sh: DOMICILE_SIGNING_KEY holds ${#KEYS[@]} secret keys, not one" >&2
  exit 1
}
KEY="${KEYS[0]}"
gpg --batch --armor --export "$KEY" >"$REPO/domicile.asc"

# The one file in <packages> matching <glob>.
built() { # glob
  local found
  found=("$PACKAGES"/$1)
  [ "${#found[@]}" -eq 1 ] && [ -f "${found[0]}" ] || {
    echo "repo.sh: wanted one $1 in $PACKAGES, found: ${found[*]}" >&2
    exit 1
  }
  echo "${found[0]}"
}

# Copies <package> to <destination>. Fails, saying so, when the repository holds
# it already.
add() { # package, destination
  if [ -e "$2" ]; then
    echo "repo.sh: the repository already has $(basename "$2"); keeping it" >&2
    return 1
  fi
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2"
}

# Deletes all but the three newest packages in <directory> named <pattern>,
# with their signatures.
prune() { # directory, pattern
  local old
  (cd "$1" && ls $2 2>/dev/null | sort -V | head -n -3) | while IFS= read -r old; do
    rm -f "$1/$old" "$1/$old.sig"
  done
}

VERSION="$(basename "$(built 'domicile_*_amd64.deb')" | sed 's/^domicile_\(.*\)_amd64\.deb$/\1/')"
# pacman's, as `distro/version.sh ... arch` gives it.
ARCH_VERSION="${VERSION//\~/}"

echo "== apt =="
for suite in current legacy; do
  case "$suite" in
    (current) deb="$(built "domicile_${VERSION}_amd64.deb")" ;;
    (legacy) deb="$(built "domicile_${VERSION}_amd64.noapparmor.deb")" ;;
  esac
  add "$deb" "$REPO/apt/pool/$suite/domicile_${VERSION}_amd64.deb" || true
  prune "$REPO/apt/pool/$suite" 'domicile_*_amd64.deb'
  index="$REPO/apt/dists/$suite/main/binary-amd64"
  mkdir -p "$index"
  (cd "$REPO/apt" && apt-ftparchive packages "pool/$suite") >"$index/Packages"
  gzip -9nkf "$index/Packages"
  (cd "$REPO/apt/dists/$suite" && apt-ftparchive \
    -o "APT::FTPArchive::Release::Origin=Domicile" \
    -o "APT::FTPArchive::Release::Label=Domicile" \
    -o "APT::FTPArchive::Release::Suite=$suite" \
    -o "APT::FTPArchive::Release::Codename=$suite" \
    -o "APT::FTPArchive::Release::Architectures=amd64" \
    -o "APT::FTPArchive::Release::Components=main" \
    release . >"$REPO/apt/dists/$suite/Release.next")
  mv "$REPO/apt/dists/$suite/Release.next" "$REPO/apt/dists/$suite/Release"
  gpg --batch --yes --local-user "$KEY" --clearsign \
    --output "$REPO/apt/dists/$suite/InRelease" "$REPO/apt/dists/$suite/Release"
  gpg --batch --yes --local-user "$KEY" --armor --detach-sign \
    --output "$REPO/apt/dists/$suite/Release.gpg" "$REPO/apt/dists/$suite/Release"
done

echo "== rpm =="
for distro in fedora opensuse; do
  rpm="$REPO/rpm/$distro/domicile-$VERSION-1.x86_64.rpm"
  if add "$(built "domicile-$VERSION-1.$distro.x86_64.rpm")" "$rpm"; then
    rpmsign --addsign \
      --define "_gpg_name $KEY" \
      --define "_gpg_path $GNUPGHOME" \
      --define "__gpg $(command -v gpg)" \
      "$rpm" >/dev/null
  fi
  prune "$REPO/rpm/$distro" 'domicile-*-1.x86_64.rpm'
  createrepo_c --quiet --update "$REPO/rpm/$distro"
  gpg --batch --yes --local-user "$KEY" --armor --detach-sign \
    --output "$REPO/rpm/$distro/repodata/repomd.xml.asc" "$REPO/rpm/$distro/repodata/repomd.xml"
done

echo "== pacman =="
arch="$REPO/arch/x86_64"
package="$arch/domicile-$ARCH_VERSION-1-x86_64.pkg.tar.zst"
if add "$(built "domicile-$ARCH_VERSION-1-x86_64.pkg.tar.zst")" "$package"; then
  gpg --batch --yes --local-user "$KEY" --detach-sign --output "$package.sig" "$package"
  repo-add --quiet --sign --key "$KEY" "$arch/domicile.db.tar.gz" "$package"
  # Object storage has no symlinks: `domicile.db` and the rest become copies.
  prune "$arch" 'domicile-*-x86_64.pkg.tar.zst'
  find "$arch" -maxdepth 1 -type l -exec sh -c 'cp --remove-destination "$(readlink -f "$1")" "$1"' sh {} \;
fi
