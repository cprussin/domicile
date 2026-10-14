#!/usr/bin/env bash
# Checks that `examples/minimal-shell` names one Domicile release: its SDK
# dependency is the exact version published from a commit, and its README runs
# and reloads the shell on that same commit, at the path the build emits.
#
# The publisher emits only `0.0.0-alpha-<sha>`, which no range like `^0.1.0`
# matches. An exact version also says which engine the SDK was built against.
# `.github/scripts/example-shell-from-npm.sh` installs the version from npm;
# this checks it offline.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/examples/minimal-shell"

command -v jq >/dev/null 2>&1 || { echo "SKIP: no jq"; exit 77; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

sdk="$(jq -r '.dependencies["@domicile-desktop/sdk"]' "$EXAMPLE/package.json")"
sha="$(sed -n 's/^0\.0\.0-alpha-\([0-9a-f]\{12\}\)$/\1/p' <<<"$sdk")"
if [ -n "$sha" ]; then
  ok "the SDK dependency is an exact published version ($sdk)"
else
  fail "the SDK dependency is an exact published version" \
    "it is \"$sdk\"; the publisher emits only 0.0.0-alpha-<12-digit sha>"
fi

# The build's output path, from the Vite config.
out_dir="$(sed -n 's/^ *outDir: "\(.*\)",$/\1/p' "$EXAMPLE/vite.config.ts")"
entry="$(sed -n 's/.*entryFileNames: "\([^"]*\)".*/\1/p' "$EXAMPLE/vite.config.ts")"
module="./$out_dir/$entry"
if [ -n "$out_dir" ] && [ -n "$entry" ]; then
  ok "the build's module path was read ($module)"
else
  fail "the build's module path was read" "no outDir or entryFileNames in vite.config.ts"
fi

readme="$EXAMPLE/README.md"
run="$(grep -E '^nix run github:cprussin/domicile/' "$readme")"
if [ -n "$sha" ] && grep -qE "^nix run github:cprussin/domicile/$sha[0-9a-f]{28} -- $module\$" <<<"$run"; then
  ok "the README runs the SDK's commit on $module"
else
  fail "the README runs the SDK's commit on $module" \
    "it says: ${run:-nothing}; wanted nix run github:cprussin/domicile/<full sha of ${sha:-?}> -- $module"
fi

load="$(grep -E '^domicile load-shell ' "$readme")"
if [ "$load" = "domicile load-shell $module" ]; then
  ok "the README reloads $module"
else
  fail "the README reloads $module" "it says: ${load:-nothing}"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "PASS: the example shell names one release: SDK $sdk, Domicile $sha"
