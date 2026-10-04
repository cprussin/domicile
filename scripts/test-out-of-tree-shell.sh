#!/usr/bin/env bash
# Build a shell that is not in this repo, against the SDK as it is published.
#
#   nix develop .#full -c ./scripts/test-out-of-tree-shell.sh
#
# Inside the workspace, `@domicile-desktop/sdk` resolves to TypeScript source
# and packages share one `node_modules`, so a shell in `packages/` builds even
# if the published SDK is broken. This copies `examples/minimal-shell` outside
# the repo, installs the SDK from its tarball, and builds it.
#
# Catches:
#   - an `exports` entry pointing at a file the package does not ship
#   - a `catalog:` range left in the published manifest
#   - a type that does not emit to `.d.ts`
#   - a relative import that leaves the package
#   - a dependency satisfied only by another workspace package
#
# The example keeps `skipLibCheck` off so the SDK's emitted declarations are
# type-checked.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/examples/minimal-shell"

command -v bun >/dev/null 2>&1 || { echo "SKIP: no bun"; exit 77; }

WORK="$(mktemp -d)"
trap 'if [ -n "${DOMICILE_KEEP_WORK:-}" ]; then echo "kept: $WORK" >&2; else rm -rf "$WORK"; fi' EXIT

# `bun pm pack` resolves `catalog:` into real ranges, so only the tarball
# shows whether the published manifest installs.
echo "== packing the SDK =="
( cd "$ROOT" && bun install --frozen-lockfile >/dev/null 2>&1 ) || {
  echo "SKIP: dependencies would not install"; exit 77; }
# The SDK is a shell's only dependency on Domicile.
( cd "$ROOT/packages/chrome-sdk" && bun run build >/dev/null 2>&1 ) || {
  echo "FAIL: @domicile-desktop/sdk would not build"; exit 1; }
( cd "$ROOT/packages/chrome-sdk" && bun pm pack --destination "$WORK" >/dev/null 2>&1 ) || {
  echo "FAIL: @domicile-desktop/sdk would not pack"; exit 1; }

SDK="$(ls "$WORK"/domicile-desktop-sdk-*.tgz 2>/dev/null | head -1)"
[ -n "$SDK" ] || { echo "FAIL: the SDK did not pack into a tarball"; exit 1; }

# Checked on the tarball, since packing is what rewrites `catalog:`.
echo "== the packed manifest names real versions =="
if tar xzOf "$SDK" package/package.json | grep -q '"catalog:"\|"workspace:\*"'; then
  echo "FAIL: $(basename "$SDK") still carries a workspace-only version range:"
  tar xzOf "$SDK" package/package.json | grep -n 'catalog:\|workspace:\*' | sed 's/^/    /'
  exit 1
fi
echo "PASS: no catalog: or workspace:* survived into a published manifest"

# Every `exports` target, not only those the example imports.
echo "== every exports target is actually shipped =="
tar xzOf "$SDK" package/package.json >"$WORK/pj.json"
tar tzf "$SDK" >"$WORK/files.txt"
if ! python3 - "$WORK/pj.json" "$WORK/files.txt" "$(basename "$SDK")" <<'PYTHON'
import json, sys

manifest, listing, name = sys.argv[1], sys.argv[2], sys.argv[3]
with open(manifest) as f:
    exports = json.load(f)["exports"]
shipped = set(open(listing).read().split())
missing = [
    target
    for entry in exports.values()
    for target in entry.values()
    if "package/" + target.removeprefix("./") not in shipped
]
if missing:
    print(f"FAIL: {name} exports point at files it does not ship:")
    for target in missing:
        print(f"    {target}")
    sys.exit(1)
PYTHON
then
  exit 1
fi
echo "PASS: every exports target is present in the tarball"

# Outside the repo, so nothing resolves by walking up to it.
echo "== building the example shell outside the repo =="
SHELL_DIR="$WORK/minimal-shell"
cp -R "$EXAMPLE" "$SHELL_DIR"
rm -rf "$SHELL_DIR/node_modules" "$SHELL_DIR/.vite"

# Point the copy at the tarball. Edit the manifest instead of `bun add`, which
# first resolves existing dependencies and 404s on an unreleased SDK version.
# The example keeps the real range because a shell author writes that.
python3 - "$SHELL_DIR/package.json" "$SDK" <<'PYTHON'
import json, sys

path, sdk = sys.argv[1], sys.argv[2]
with open(path) as f:
    package = json.load(f)
package["dependencies"]["@domicile-desktop/sdk"] = f"file:{sdk}"
with open(path, "w") as f:
    json.dump(package, f, indent=2)
PYTHON

if ! ( cd "$SHELL_DIR" && bun install >"$WORK/install.log" 2>&1 ); then
  # A network failure is a skip. Show the log for anything else.
  if grep -qiE 'getaddrinfo|ENOTFOUND|ECONNREFUSED|failed to resolve|network' "$WORK/install.log"; then
    echo "SKIP: the example's dependencies would not install (no network?)"
    exit 77
  fi
  echo "FAIL: the SDK tarballs would not install into a bare project:"
  tail -20 "$WORK/install.log" | sed 's/^/    /'
  exit 1
fi

if ! ( cd "$SHELL_DIR" && bunx tsc --noEmit >"$WORK/tsc.log" 2>&1 ); then
  echo "FAIL: the example shell does not typecheck against the published SDK:"
  sed 's/^/    /' "$WORK/tsc.log"
  exit 1
fi
echo "PASS: it typechecks against the SDK's emitted .d.ts"

if ! ( cd "$SHELL_DIR" && bun run build >"$WORK/build.log" 2>&1 ); then
  echo "FAIL: the example shell does not build against the published SDK:"
  tail -30 "$WORK/build.log" | sed 's/^/    /'
  exit 1
fi

# A shell build emits one module, `shell.js`, at a fixed name. Vite hashes
# entry chunks by default, and `DOMICILE_MODULE` cannot name a hashed file, so
# a missing `entryFileNames` builds fine but leaves a blank desktop.
PAGE="$SHELL_DIR/.vite/renderer/main_window"
if [ ! -f "$PAGE/shell.js" ]; then
  echo "FAIL: the build emitted no shell.js, which is what Domicile serves. It has:"
  find "$SHELL_DIR/.vite" -type f 2>/dev/null | sed "s|$SHELL_DIR/|    |" | head -10
  echo "  A hashed entry name is the likely cause: nothing outside the build"
  echo "  can name one, so there would be no path to hand Domicile."
  exit 1
fi

# Domicile writes the document. `serve-shell.ts` prefers the module, so an
# `index.html` would never be fetched.
if [ -f "$PAGE/index.html" ]; then
  echo "FAIL: the build emitted an index.html beside the module. Domicile"
  echo "  writes the document; a shell that ships one has built a file nothing"
  echo "  will ever load."
  exit 1
fi

echo "PASS: a shell outside this repo builds against the published SDK and emits the module Domicile serves"
