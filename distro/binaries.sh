#!/usr/bin/env bash
# Builds the Rust programs in `distro/programs` into <out>, for
# `distro/stage.sh`.
#
#   distro/binaries.sh <out>
#
# A binary runs only on the glibc it was built against or a newer one, so build
# on the oldest distribution the packages support. CI builds in Debian 12.
#
# Needs cargo and the headers the compositor builds against: libxkbcommon,
# Wayland, libpipewire, and libclang for the `pipewire` crate's bindings.
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: binaries.sh <out>" >&2
  exit 2
}
OUT="$1"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mapfile -t PROGRAMS < <(grep -v '^#' distro/programs)

# `domicile-compositor` is named because `default-members` omits it. Each
# binary is named so the test-only ones are not built, as in `flake.nix`.
args=(-p domicile-compositor -p domicile-launch -p domicile-miracast)
for program in "${PROGRAMS[@]}"; do
  args+=(--bin "$program")
done
cargo build --release --locked "${args[@]}"

mkdir -p "$OUT"
for program in "${PROGRAMS[@]}"; do
  install -m 755 "target/release/$program" "$OUT/$program"
done
