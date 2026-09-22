#!/usr/bin/env bash
# That `domicile-node-modules` builds to the same store path twice.
#
# A node_modules derivation is the easiest thing in this flake to make
# unreproducible — a postinstall that writes a timestamp, a lockfile resolved
# at build time — and the failure it produces is not a build error. It is a
# shell whose page differs between two machines that both built from the same
# commit.
#
# `nix-store --realise --check` is the flag that says so: it rebuilds a
# derivation whose output is already in the store and fails if the result
# differs. (`--realise`, with the s, is Nix's own spelling and the one exemption
# AGENTS.md grants the American-English rule: it is somebody else's API.)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/nix-check.sh"
require_nix
cd "$ROOT"

drv="$(nix path-info --derivation .#simple)"

# The closure captured whole and then filtered, rather than piped through
# `head -1`. `head` exits after its line and closes the pipe, `grep` takes
# SIGPIPE, and under `pipefail` that is a failed pipeline -- intermittently,
# depending on whether grep had finished first. It happened to pass on run
# 35552949482 and is the hazard `guard-css-and-resize.sh` documents.
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
