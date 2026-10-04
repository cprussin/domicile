#!/usr/bin/env bash
# Checks the `domicile` derivation places its parts where `domicile` looks.
#
# `domicile` finds the compositor and engine from `current_exe` and
# `../libexec`. If `bin/domicile` is a symlink into another derivation,
# `current_exe` resolves to a path with no `libexec`, and the desktop fails at
# run time despite a green build. See
# `/docs/architecture/THE-DOMICILE-BINARY.md`.
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
