#!/usr/bin/env bash
# Checks `domicile-node-modules` rebuilds to identical output.
#
# A postinstall timestamp or a lockfile resolved at build time makes it
# unreproducible without any build error, so the same commit yields different
# pages on different machines. `nix-store --realise --check` rebuilds the
# output and fails if it differs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

drv="$(nix path-info --derivation .#simple)"

# Capture the closure, then filter. Piping into `head -1` can SIGPIPE the
# writer, which fails intermittently under `pipefail`.
closure="$(nix-store -qR "$drv")"
node_modules=""
while IFS= read -r path; do
  case "$path" in
    (*domicile-node-modules*.drv) node_modules="$path"; break ;;
  esac
done <<EOF
$closure
EOF
[ -n "$node_modules" ] || {
  echo "no domicile-node-modules derivation in the closure of $drv, so nothing" >&2
  echo "  was rechecked — the name changed, or the shells stopped using one" >&2
  exit 1
}
nix-store --realise --check "$node_modules"
