#!/usr/bin/env bash
# Installs each distribution package in its distribution's container and checks
# the result with `scripts/lib/distro-installed.sh`.
#
#   DOMICILE_DISTRO_PACKAGES=<dir> scripts/distro-packages-install.sh
#
# <dir> holds `distro/build.sh`'s output. `DOMICILE_DISTROS` picks
# distributions, space separated: debian ubuntu fedora opensuse arch (the
# default is all). Recommended packages are not installed, so the install
# proves the hard dependencies are enough. No GPU is needed: nothing draws.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLED="$ROOT/scripts/lib/distro-installed.sh"
[ -f "$INSTALLED" ] || { echo "no $INSTALLED" >&2; exit 1; }

PACKAGES="${DOMICILE_DISTRO_PACKAGES:-}"
if [ -z "$PACKAGES" ]; then
  echo "  SKIP: DOMICILE_DISTRO_PACKAGES is unset; make packages with distro/build.sh"
  exit 77
fi
if ! docker info >/dev/null 2>&1; then
  echo "  SKIP: no docker daemon to run the distributions' containers"
  exit 77
fi
PACKAGES="$(cd "$PACKAGES" && pwd)"

# Each distribution's image, its package, and how it installs a local package
# (`$1`) without recommended ones.
image_of() {
  case "$1" in
    (debian) echo debian:trixie ;;
    (ubuntu) echo ubuntu:24.04 ;;
    (fedora) echo fedora:44 ;;
    (opensuse) echo opensuse/tumbleweed:latest ;;
    (arch) echo archlinux:latest ;;
    (*) return 1 ;;
  esac
}
package_of() {
  case "$1" in
    (debian | ubuntu) echo '*.deb' ;;
    (fedora) echo '*.fedora.x86_64.rpm' ;;
    (opensuse) echo '*.opensuse.x86_64.rpm' ;;
    (arch) echo '*.pkg.tar.zst' ;;
  esac
}
install_of() {
  case "$1" in
    (debian | ubuntu)
      echo 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$1"' ;;
    (fedora) echo 'dnf install -y --nogpgcheck --setopt=install_weak_deps=False "$1"' ;;
    (opensuse) echo 'zypper --non-interactive install --no-recommends --allow-unsigned-rpm "$1"' ;;
    (arch) echo 'pacman -Syu --noconfirm && pacman -U --noconfirm "$1"' ;;
  esac
}

FAILED=0
for distro in ${DOMICILE_DISTROS:-debian ubuntu fedora opensuse arch}; do
  image="$(image_of "$distro")" || {
    echo "no distribution named $distro" >&2
    exit 1
  }
  set -- $(cd "$PACKAGES" && ls $(package_of "$distro") 2>/dev/null)
  if [ "$#" -ne 1 ]; then
    echo "FAIL: $distro: wanted one $(package_of "$distro") in $PACKAGES, found $#"
    FAILED=$((FAILED + 1))
    continue
  fi
  echo "== $distro ($image): $1 =="
  # One `sh -c`, so the install and the checks share the container.
  if timeout -k 30 1800 docker run --rm \
      -v "$PACKAGES:/packages:ro" \
      -v "$INSTALLED:/distro-installed.sh:ro" \
      "$image" sh -c "$(install_of "$distro") && sh /distro-installed.sh" \
      sh "/packages/$1" 2>&1 | sed "s/^PASS: /PASS: $distro: /"; then
    echo "$distro: ok"
  else
    echo "FAIL: $distro: the install or a check failed"
    FAILED=$((FAILED + 1))
  fi
done

[ "$FAILED" -eq 0 ]
