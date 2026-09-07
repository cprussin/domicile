#!/usr/bin/env bash
# Build a shell that is not in this repo, against the SDK as it is published.
#
#   nix develop .#full -c ./scripts/test-out-of-tree-shell.sh
#
# Nothing inside the workspace can check this. In here `@domicile/chrome-sdk`
# resolves to a symlinked directory of TypeScript source, `catalog:` and
# `workspace:*` mean something, and every package shares one `node_modules` —
# so a shell in `packages/` builds whether or not the SDK is consumable
# anywhere else. `examples/minimal-shell` is deliberately outside the
# workspace, and this copies it somewhere outside the repo entirely, installs
# the SDK from tarballs, and builds it there.
#
# What that catches, and only this catches: an `exports` entry pointing at a
# file `files` does not ship — every entry, not merely the ones the example
# imports — a `catalog:` that survived into a published manifest, a type that
# will not emit to `.d.ts`, a relative import climbing out of the package, and a
# dependency that is only ever satisfied because some *other* workspace package
# happens to depend on it.
#
# The example keeps `skipLibCheck` off for the third of those: the SDK's emitted
# declarations are what a shell author actually programs against, and
# `skipLibCheck` is exactly the flag that stops them being checked.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/examples/minimal-shell"

command -v bun >/dev/null 2>&1 || { echo "SKIP: no bun"; exit 77; }

WORK="$(mktemp -d)"
trap 'if [ -n "${DOMICILE_KEEP_WORK:-}" ]; then echo "kept: $WORK" >&2; else rm -rf "$WORK"; fi' EXIT

# The SDK as it would reach npm: built, packed, and read back out of the
# tarball. `bun pm pack` is what resolves `catalog:` into a real range, so a
# tarball is the only artifact that proves the published manifest is installable.
echo "== packing the SDK =="
( cd "$ROOT" && bun install --frozen-lockfile >/dev/null 2>&1 ) || {
  echo "SKIP: dependencies would not install"; exit 77; }
# One package, where there were two: `@domicile/electron-chrome-host` was the
# other, and a shell needed it because a shell was an Electron application.
# Under the fork a shell is a built web page and the SDK is the whole of its
# dependency on Domicile.
( cd "$ROOT/packages/chrome-sdk" && bun run build >/dev/null 2>&1 ) || {
  echo "FAIL: @domicile/chrome-sdk would not build"; exit 1; }
( cd "$ROOT/packages/chrome-sdk" && bun pm pack --destination "$WORK" >/dev/null 2>&1 ) || {
  echo "FAIL: @domicile/chrome-sdk would not pack"; exit 1; }

SDK="$(ls "$WORK"/domicile-chrome-sdk-*.tgz 2>/dev/null | head -1)"
[ -n "$SDK" ] || { echo "FAIL: the SDK did not pack into a tarball"; exit 1; }

# A published manifest that still says `catalog:` installs nowhere. Checked on
# the tarball rather than on the source, because this is the one place the two
# differ and the difference is the whole point.
echo "== the packed manifest names real versions =="
if tar xzOf "$SDK" package/package.json | grep -q '"catalog:"\|"workspace:\*"'; then
  echo "FAIL: $(basename "$SDK") still carries a workspace-only version range:"
  tar xzOf "$SDK" package/package.json | grep -n 'catalog:\|workspace:\*' | sed 's/^/    /'
  exit 1
fi
echo "PASS: no catalog: or workspace:* survived into a published manifest"

# Every `exports` target, not merely the ones the example imports. The example
# reaches a handful of the SDK's subpaths, so without this the rest could point
# at nothing and this script would still be green — and the entry a shell author
# reaches for first is as likely to be one of those.
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

# Outside the repo, so nothing resolves by climbing out of it.
echo "== building the example shell outside the repo =="
SHELL_DIR="$WORK/minimal-shell"
cp -R "$EXAMPLE" "$SHELL_DIR"
rm -rf "$SHELL_DIR/node_modules" "$SHELL_DIR/.vite"

# Point the copy at the tarball, in place of the published range it carries.
# Rewritten rather than `bun add`ed: adding resolves every *existing* dependency
# first, and the example names `@domicile/chrome-sdk` by a version that is only
# on npm once it is released — so the add fails on a 404 before it ever looks at
# the file it was given. The example keeps the real range because it is what a
# shell author writes.
python3 - "$SHELL_DIR/package.json" "$SDK" <<'PYTHON'
import json, sys

path, sdk = sys.argv[1], sys.argv[2]
with open(path) as f:
    package = json.load(f)
package["dependencies"]["@domicile/chrome-sdk"] = f"file:{sdk}"
with open(path, "w") as f:
    json.dump(package, f, indent=2)
PYTHON

if ! ( cd "$SHELL_DIR" && bun install >"$WORK/install.log" 2>&1 ); then
  # A network failure here is the machine, not the SDK. Anything else is this
  # check's own subject, so the log is shown rather than swallowed by the skip.
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

# WHAT A SHELL IS, AND THEREFORE WHAT ITS BUILD HAS TO PRODUCE: one module,
# under a name something other than the shell can say. There used to be five
# artifacts here — a launcher, an Electron main bundle, a preload, a
# `package.json` naming the module type, and the page — because a shell was an
# application. Then there was a page and a document. Domicile writes the
# document now, so this is the whole of it.
#
# BY NAME, and that is the assertion. Vite hashes an entry chunk by default, so
# a config that dropped `entryFileNames` still builds, still exits zero, and
# emits `assets/index-<hash>.js` — which `DOMICILE_MODULE` cannot name, because
# the hash changes every time the shell does. The failure is a desktop that
# comes up blank with a 404 nobody is looking at.
PAGE="$SHELL_DIR/.vite/renderer/main_window"
if [ ! -f "$PAGE/shell.js" ]; then
  echo "FAIL: the build emitted no shell.js, which is what Domicile serves. It has:"
  find "$SHELL_DIR/.vite" -type f 2>/dev/null | sed "s|$SHELL_DIR/|    |" | head -10
  echo "  A hashed entry name is the likely cause: nothing outside the build"
  echo "  can name one, so there would be no path to hand Domicile."
  exit 1
fi

# And no document, because shipping one is how a shell would try to take back
# the part Domicile owns. `serve-shell.ts` prefers a module, so an `index.html`
# beside one is a file nothing fetches — dead weight that reads like a page.
if [ -f "$PAGE/index.html" ]; then
  echo "FAIL: the build emitted an index.html beside the module. Domicile"
  echo "  writes the document; a shell that ships one has built a file nothing"
  echo "  will ever load."
  exit 1
fi

echo "PASS: a shell outside this repo builds against the published SDK and emits the module Domicile serves"
