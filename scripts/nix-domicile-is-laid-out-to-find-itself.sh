#!/usr/bin/env bash
# That the `domicile` derivation places its parts where `domicile` looks.
#
# `domicile` finds the compositor and the engine relative to its own binary —
# `current_exe`, then `../libexec` beside it — which is what lets one derivation
# hold a desktop. The consequence is that HOW the files are placed is part of
# the contract, and nothing about a successful `nix build` says they were placed
# that way.
#
# THE SYMLINK IS THE ONE THAT BIT. A `bin/domicile` that is a symlink into
# another derivation resolves, through `current_exe`, into a store path with no
# `libexec` beside it — so the desktop refuses to start, at run time, on a
# machine that built everything green. See
# `/docs/architecture/THE-DOMICILE-BINARY.md` for why the flake only places
# files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

out="$(nix build --no-link --print-out-paths .#domicile)"

[ -x "$out/bin/domicile" ] || {
  echo "no bin/domicile in $out" >&2
  exit 1
}
[ ! -L "$out/bin/domicile" ] || {
  echo "bin/domicile is a symlink, so \`current_exe\` will resolve it into a" >&2
  echo "  derivation with no libexec beside it and the desktop will refuse to" >&2
  echo "  start. Copy it." >&2
  exit 1
}
[ -x "$out/bin/domicile-compositor" ] || {
  echo "no bin/domicile-compositor beside the binary" >&2
  exit 1
}
[ -x "$out/libexec/domicile/engine/chrome" ] || {
  echo "libexec/domicile/engine holds no chrome" >&2
  exit 1
}
echo "domicile is laid out to find the rest of itself"
