#!/usr/bin/env bash
# Checks `distro/repo.sh`: apt, rpm and pacman each read the repositories it
# builds, verify their signatures and pick the newest version, and the
# repositories keep the three newest versions.
#
# Uses small stand-in packages, so it needs no build. The real packages are
# installed from these repositories in `scripts/distro-packages-install.sh`.
#
# `DOMICILE_REPO_TOOLS=1` says the tools in `distro/repo-tools`, nfpm,
# libarchive and fakeroot are on PATH already; otherwise they come from the
# flake's nixpkgs.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix

if [ "${DOMICILE_REPO_TOOLS:-}" != 1 ]; then
  mapfile -t tools < <(sed -n 's/^\([a-z]\)/nixpkgs#\1/p' "$ROOT/distro/repo-tools")
  exec nix shell --inputs-from "$ROOT" "${tools[@]}" nixpkgs#nfpm nixpkgs#libarchive nixpkgs#fakeroot \
    --command env DOMICILE_REPO_TOOLS=1 "$0"
fi

WORK="$(mktemp -d)"
trap 'gpgconf --homedir "$WORK/pacman-keys" --kill all 2>/dev/null; rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    ok "$1"
  else
    fail "$1" "wanted: $(printf '%q' "$2")  got: $(printf '%q' "$3")"
  fi
}

# Stand-ins for `distro/build.sh`'s output at <version>, installing a file that
# holds <content>.
packages() { # version, content
  local out="$WORK/packages-$1-$2"
  mkdir -p "$out" "$WORK/content"
  echo "$2" >"$WORK/content/version"
  cat >"$WORK/nfpm.yaml" <<YAML
name: domicile
arch: amd64
version: "$1"
release: "1"
maintainer: Test <test@domicile.invalid>
description: A stand-in.
license: MIT
contents:
  - src: $WORK/content/version
    dst: /usr/share/domicile/version
YAML
  nfpm package --config "$WORK/nfpm.yaml" --packager deb --target "$out/domicile_$1_amd64.deb" >/dev/null
  nfpm package --config "$WORK/nfpm.yaml" --packager deb --target "$out/domicile_$1_amd64.noapparmor.deb" >/dev/null
  nfpm package --config "$WORK/nfpm.yaml" --packager rpm --target "$out/domicile-$1-1.fedora.x86_64.rpm" >/dev/null
  nfpm package --config "$WORK/nfpm.yaml" --packager rpm --target "$out/domicile-$1-1.opensuse.x86_64.rpm" >/dev/null
  nfpm package --config "$WORK/nfpm.yaml" --packager archlinux --target "$out/domicile-$1-1-x86_64.pkg.tar.zst" >/dev/null
  echo "$out"
}

DOMICILE_SIGNING_KEY="$("$ROOT/distro/repo-test-key.sh")"
export DOMICILE_SIGNING_KEY
REPO="$WORK/repo"

echo "four releases into one repository"
for version in 1.0.0 1.0.1 1.0.2 1.0.3; do
  if out="$("$ROOT/distro/repo.sh" "$(packages "$version" "$version")" "$REPO" 2>&1)"; then
    ok "repo.sh adds $version"
  else
    fail "repo.sh adds $version" "$out"
  fi
done

echo "apt"
for suite in current legacy; do
  apt="$WORK/apt-$suite"
  mkdir -p "$apt/lists/partial" "$apt/cache/archives/partial" "$apt/etc/sources.list.d" \
    "$apt/etc/apt.conf.d" "$apt/etc/preferences.d" "$apt/status"
  touch "$apt/status/status"
  echo "deb [signed-by=$REPO/domicile.asc] file:$REPO/apt $suite main" >"$apt/etc/sources.list"
  apt_get=(-o "Dir::Etc=$apt/etc" -o "Dir::State::Lists=$apt/lists"
    -o "Dir::State::status=$apt/status/status" -o "Dir::Cache=$apt/cache"
    -o APT::Architecture=amd64 -o APT::Sandbox::User=root
    -o "Dir::Bin::dpkg=$(command -v true)")
  if out="$(apt-get "${apt_get[@]}" update 2>&1)" && ! grep -q '^[WE]:' <<<"$out"; then
    ok "apt verifies the $suite suite"
  else
    fail "apt verifies the $suite suite" "$out"
  fi
  expect "apt lists the three newest versions in $suite" "1.0.3-1 1.0.2-1 1.0.1-1" \
    "$(apt-cache "${apt_get[@]}" madison domicile 2>&1 | awk '{print $3}' | paste -sd' ')"
done

echo "rpm"
for distro in fedora opensuse; do
  rpmdb="$WORK/rpmdb-$distro"
  mkdir -p "$rpmdb"
  rpmkeys --dbpath "$rpmdb" --import "$REPO/domicile.asc"
  for rpm in "$REPO/rpm/$distro"/*.rpm; do
    if out="$(rpmkeys --dbpath "$rpmdb" --checksig "$rpm" 2>&1)" && grep -q 'signatures OK' <<<"$out"; then
      ok "$distro's $(basename "$rpm") is signed"
    else
      fail "$distro's $(basename "$rpm") is signed" "$out"
    fi
  done
  mkdir -p -m 700 "$WORK/rpm-keys"
  gpg --homedir "$WORK/rpm-keys" --batch --quiet --import "$REPO/domicile.asc"
  if out="$(gpg --homedir "$WORK/rpm-keys" --batch --verify \
    "$REPO/rpm/$distro/repodata/repomd.xml.asc" "$REPO/rpm/$distro/repodata/repomd.xml" 2>&1)"; then
    ok "$distro's repodata is signed"
  else
    fail "$distro's repodata is signed" "$out"
  fi
  expect "$distro's repodata lists the three newest versions" "1.0.1 1.0.2 1.0.3" \
    "$(bsdcat "$REPO/rpm/$distro"/repodata/*-primary.xml.* | grep -o '<version [^>]*ver="[^"]*"' | grep -o 'ver="[^"]*"' | cut -d'"' -f2 | sort -V | paste -sd' ')"
done

echo "pacman"
# pacman and pacman-key refuse to run unless root.
as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"; else fakeroot -- "$@"; fi
}
keys="$WORK/pacman-keys"
cat >"$WORK/pacman.conf" <<CONF
[options]
DBPath = $WORK/pacman-db
CacheDir = $WORK/pacman-cache
GPGDir = $keys
Architecture = x86_64
SigLevel = Required

[domicile]
Server = file://$REPO/arch/\$arch
CONF
mkdir -p "$WORK/pacman-db" "$WORK/pacman-cache"
as_root pacman-key --config "$WORK/pacman.conf" --gpgdir "$keys" --init >/dev/null 2>&1
as_root pacman-key --config "$WORK/pacman.conf" --gpgdir "$keys" --add "$REPO/domicile.asc" >/dev/null 2>&1
fingerprint="$(gpg --homedir "$WORK/rpm-keys" --show-keys --with-colons "$REPO/domicile.asc" | awk -F: '/^fpr/ {print $10; exit}')"
as_root pacman-key --config "$WORK/pacman.conf" --gpgdir "$keys" --lsign-key "$fingerprint" >/dev/null 2>&1
if out="$(as_root pacman --config "$WORK/pacman.conf" -Sy 2>&1)"; then
  ok "pacman verifies the database"
else
  fail "pacman verifies the database" "$out"
fi
if out="$(as_root pacman --config "$WORK/pacman.conf" -Sw --noconfirm domicile 2>&1)"; then
  ok "pacman verifies the package"
else
  fail "pacman verifies the package" "$out"
fi
expect "pacman picks the newest" "domicile-1.0.3-1-x86_64.pkg.tar.zst" \
  "$(cd "$WORK/pacman-cache" && ls domicile-*.pkg.tar.zst)"

echo "older versions are removed"
expect "no file of 1.0.0 is left" "" "$(cd "$REPO" && find . -name '*1.0.0*')"

echo "a published version is never replaced"
# A rerun of a release rebuilds its packages, whose bytes differ.
before="$(cd "$REPO" && find . -type f ! -path '*/repodata/*' -name 'domicile*1.0.3*' -exec sha256sum {} + | sort)"
if out="$("$ROOT/distro/repo.sh" "$(packages 1.0.3 changed)" "$REPO" 2>&1)"; then
  expect "repo.sh keeps the published 1.0.3" "$before" \
    "$(cd "$REPO" && find . -type f ! -path '*/repodata/*' -name 'domicile*1.0.3*' -exec sha256sum {} + | sort)"
else
  fail "repo.sh adds a rebuilt 1.0.3" "$out"
fi

[ "$FAILED" -eq 0 ]
