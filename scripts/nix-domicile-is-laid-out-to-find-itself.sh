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
[ -x "$out/bin/domicile-history" ] && [ ! -L "$out/bin/domicile-history" ] || {
  echo "bin/domicile-history is missing or a symlink, so it cannot find the" >&2
  echo "  \`domicile\` beside it" >&2
  exit 1
}
[ -f "$out/libexec/domicile/apps/history/manifest.json" ] || {
  echo "libexec/domicile/apps/history holds no manifest.json, so no desktop" >&2
  echo "  installs the History app" >&2
  exit 1
}

# Each launcher entry's program, icon and preview, which a launcher finds by
# path.
for entry in history screenshot shutdown reboot; do
  file="$out/share/applications/domicile-$entry.desktop"
  [ -f "$file" ] || {
    echo "no launcher entry domicile-$entry.desktop" >&2
    exit 1
  }
  for key in Exec Icon X-Domicile-Preview; do
    path="$(sed -n "s/^$key=\([^ ]*\).*/\1/p" "$file")"
    [ -e "$path" ] || {
      echo "domicile-$entry.desktop: $key names $path, which does not exist" >&2
      exit 1
    }
  done
done
echo "domicile is laid out to find the rest of itself"
