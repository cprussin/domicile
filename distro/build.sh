#!/usr/bin/env bash
# Makes the distribution packages from the binaries `distro/binaries.sh` built.
#
#   distro/build.sh <binaries> <out>
#
# Writes to <out>:
#
#   domicile_<version>_amd64.deb                  Debian 13+, Ubuntu 24.04+
#   domicile-<version>-1.fedora.x86_64.rpm        Fedora, RHEL 10+
#   domicile-<version>-1.opensuse.x86_64.rpm      openSUSE Tumbleweed
#   domicile-<version>-1-x86_64.pkg.tar.zst       Arch
#   SHA256SUMS
#
# Nix is the source of the pins: the engine is the one `nix build .#engine`
# fetches, and bun, node and nfpm are the flake's nixpkgs'. The packages ship
# upstream's bun binary, the source of nixpkgs' `bun`.
#
# Builds the workspace in this checkout, as `shellPage`, `appExtension` and
# `shellWorkspace` do in `flake.nix`.
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: build.sh <binaries> <out>" >&2
  exit 2
}
BINARIES="$(cd "$1" && pwd)"
mkdir -p "$2"
OUT="$(cd "$2" && pwd)"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The one store path `installable` builds, from this flake or its nixpkgs.
# Packages name their output (`^bin`, `^out`): a package with several outputs
# prints a path per output.
store_path() { # installable
  local paths
  paths="$(nix build --no-link --print-out-paths --inputs-from "$ROOT" "$1")"
  [ "$(printf '%s\n' "$paths" | wc -l)" -eq 1 ] || {
    echo "build.sh: $1 built more than one store path: $paths" >&2
    exit 1
  }
  echo "$paths"
}

echo "== tools and pins from the flake =="
PATH="$(store_path 'nixpkgs#bun^out')/bin:$(store_path 'nixpkgs#nodejs_24^out')/bin:$PATH"
NFPM="$(store_path 'nixpkgs#nfpm^out')/bin/nfpm"
UNZIP="$(store_path 'nixpkgs#unzip^out')/bin/unzip"
UNZSTD="$(store_path 'nixpkgs#zstd^bin')/bin/unzstd"
READELF="$(store_path 'nixpkgs#binutils-unwrapped^out')/bin/readelf"
ENGINE_TARBALL="$(store_path .#engine.src)"
BUN_ZIP="$(store_path nixpkgs#bun.src)"

echo "== the workspace =="
# As `nodeModules` and `sharedShellConfigure`: no install scripts, and `CI`
# stops turbo's `//#build:install-modules` from installing again.
export CI=1 TURBO_TELEMETRY_DISABLED=1
bun install --frozen-lockfile --ignore-scripts --no-progress
node_modules/.bin/turbo run prepare build \
  --filter "@domicile-desktop/manganese..." --no-daemon
node_modules/.bin/turbo build:vite --no-daemon \
  --filter ./packages/shell-manganese \
  --filter ./packages/shell-simple \
  --filter ./packages/shell-splash \
  --filter ./packages/app-history \
  --filter ./packages/app-settings

echo "== the engine and bun =="
mkdir -p "$WORK/engine" "$WORK/bun"
tar --use-compress-program="$UNZSTD" -xf "$ENGINE_TARBALL" -C "$WORK/engine"
# The tarball holds one directory, with `chrome` directly inside.
ENGINE="$(echo "$WORK"/engine/*/)"
"$UNZIP" -q -j "$BUN_ZIP" '*/bun' -d "$WORK/bun"

echo "== the tree =="
distro/stage.sh "$BINARIES" "$ENGINE" "$WORK/bun/bun" "$ROOT" "$WORK/stage"

# Each format names the glibc the binaries need: the newest symbol version any
# staged ELF file uses.
GLIBC="$(
  find "$WORK/stage" -type f -print0 |
    while IFS= read -r -d '' file; do
      if [ "$(od -An -tx1 -N4 "$file" | tr -d ' ')" = 7f454c46 ]; then
        "$READELF" --dyn-syms --wide "$file"
      fi
    done |
    grep -o 'GLIBC_[0-9][0-9.]*' | sed 's/^GLIBC_//' | sort -uV | tail -1
)"
[ -n "$GLIBC" ] || {
  echo "build.sh: no staged binary names a glibc version" >&2
  exit 1
}

# Later commits sort later in every format: `0.<date>.<time>` of the commit,
# in UTC.
VERSION="0.$(TZ=UTC git log -1 --format=%cd --date=format-local:%Y%m%d.%H%M%S)"

echo "== packages: version $VERSION, glibc $GLIBC =="
# nfpm's Arch packager holds every file open until it finishes, and the
# workspace alone is over 30,000 files.
ulimit -n "$(ulimit -Hn)"
package() { # nfpm packager, pam file, target
  local config="$WORK/nfpm-$2.yaml"
  sed -e "s|@stage@|$WORK/stage|g" \
    -e "s|@distro@|$ROOT/distro|g" \
    -e "s|@pam@|$2|g" \
    -e "s|@version@|$VERSION|g" \
    -e "s|@glibc@|$GLIBC|g" \
    distro/nfpm.yaml >"$config"
  if grep -nE '@[a-z]+@' "$config"; then
    echo "build.sh: distro/nfpm.yaml has a placeholder build.sh does not fill" >&2
    exit 1
  fi
  "$NFPM" package --config "$config" --packager "$1" --target "$OUT/$3"
}
MADE=(
  "domicile_${VERSION}_amd64.deb"
  "domicile-$VERSION-1.fedora.x86_64.rpm"
  "domicile-$VERSION-1.opensuse.x86_64.rpm"
  "domicile-$VERSION-1-x86_64.pkg.tar.zst"
)
package deb debian "${MADE[0]}"
package rpm fedora "${MADE[1]}"
package rpm opensuse "${MADE[2]}"
package archlinux archlinux "${MADE[3]}"

(cd "$OUT" && sha256sum "${MADE[@]}" >SHA256SUMS)
