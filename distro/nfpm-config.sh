#!/usr/bin/env bash
# Prints `distro/nfpm.yaml` filled in for one package.
#
#   distro/nfpm-config.sh <stage> <pam> <version> <glibc> [--without-apparmor]
#
# The arguments are the `@…@` values `distro/nfpm.yaml` describes.
# `--without-apparmor` drops the lines between `# AppArmor 4 {` and
# `# AppArmor 4 }`, for releases whose AppArmor predates `userns`.
set -euo pipefail

[ "$#" -eq 4 ] || { [ "$#" -eq 5 ] && [ "$5" = --without-apparmor ]; } || {
  echo "usage: nfpm-config.sh <stage> <pam> <version> <glibc> [--without-apparmor]" >&2
  exit 2
}

DISTRO="$(cd "$(dirname "$0")" && pwd)"

# The GStreamer plugins `domicile-recorder` loads, by the RPM distribution's
# names. One line, so the list item expands to several.
case "$2" in
  opensuse) gstreamer="gstreamer-plugins-base\n      - gstreamer-plugins-good\n      - gstreamer-plugin-pipewire" ;;
  *) gstreamer="gstreamer1-plugins-base\n      - gstreamer1-plugins-good\n      - pipewire-gstreamer" ;;
esac

drop=()
[ "$#" -eq 4 ] || drop=(-e '/^ *# AppArmor 4 {$/,/^ *# AppArmor 4 }$/d')

config="$(sed "${drop[@]}" \
  -e "s|@stage@|$1|g" \
  -e "s|@distro@|$DISTRO|g" \
  -e "s|@pam@|$2|g" \
  -e "s|@version@|$3|g" \
  -e "s|@glibc@|$4|g" \
  -e "s|\"@rpm-gstreamer@\"|$gstreamer|g" \
  "$DISTRO/nfpm.yaml")"
if grep -nE '@[a-z]+@' <<<"$config"; then
  echo "nfpm-config.sh: distro/nfpm.yaml has a placeholder this does not fill" >&2
  exit 1
fi
echo "$config"
