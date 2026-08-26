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
# The example keeps `skipLibCheck` off for the third of those. It is a `.d.ts`
# that declares what the preload puts on the page, and `skipLibCheck` is exactly
# the flag that stops such a file being checked — with it on, the one binding
# between the page and the SDK went unverified.
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
for package in chrome-sdk electron-chrome-host; do
  ( cd "$ROOT/packages/$package" && bun run build >/dev/null 2>&1 ) || {
    echo "FAIL: @domicile/$package would not build"; exit 1; }
  ( cd "$ROOT/packages/$package" && bun pm pack --destination "$WORK" >/dev/null 2>&1 ) || {
    echo "FAIL: @domicile/$package would not pack"; exit 1; }
done

SDK="$(ls "$WORK"/domicile-chrome-sdk-*.tgz 2>/dev/null | head -1)"
HOST="$(ls "$WORK"/domicile-electron-chrome-host-*.tgz 2>/dev/null | head -1)"
[ -n "$SDK" ] && [ -n "$HOST" ] || { echo "FAIL: the SDK did not pack into tarballs"; exit 1; }

# A published manifest that still says `catalog:` installs nowhere. Checked on
# the tarball rather than on the source, because this is the one place the two
# differ and the difference is the whole point.
echo "== the packed manifests name real versions =="
for tarball in "$SDK" "$HOST"; do
  if tar xzOf "$tarball" package/package.json | grep -q '"catalog:"\|"workspace:\*"'; then
    echo "FAIL: $(basename "$tarball") still carries a workspace-only version range:"
    tar xzOf "$tarball" package/package.json | grep -n 'catalog:\|workspace:\*' | sed 's/^/    /'
    exit 1
  fi
done
echo "PASS: no catalog: or workspace:* survived into a published manifest"

# Every `exports` target, not merely the ones the example imports. The example
# reaches a handful of the two packages' 33 subpaths, so without this the rest
# could point at nothing and this script would still be green — and the entry a
# shell author reaches for first is as likely to be one of those.
echo "== every exports target is actually shipped =="
for tarball in "$SDK" "$HOST"; do
  tar xzOf "$tarball" package/package.json >"$WORK/pj.json"
  tar tzf "$tarball" >"$WORK/files.txt"
  if ! python3 - "$WORK/pj.json" "$WORK/files.txt" "$(basename "$tarball")" <<'PYTHON'
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
done
echo "PASS: every exports target is present in both tarballs"

# Outside the repo, so nothing resolves by climbing out of it.
echo "== building the example shell outside the repo =="
SHELL_DIR="$WORK/minimal-shell"
cp -R "$EXAMPLE" "$SHELL_DIR"
rm -rf "$SHELL_DIR/node_modules" "$SHELL_DIR/.vite"

# Point the copy at the tarballs, in place of the published ranges it carries.
# Rewritten rather than `bun add`ed: adding resolves every *existing* dependency
# first, and the example names `@domicile/chrome-sdk` by a version that is only
# on npm once it is released — so the add fails on a 404 before it ever looks at
# the file it was given. The example keeps the real ranges because they are what
# a shell author writes.
python3 - "$SHELL_DIR/package.json" "$SDK" "$HOST" <<'PYTHON'
import json, sys

path, sdk, host = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    package = json.load(f)
package["dependencies"]["@domicile/chrome-sdk"] = f"file:{sdk}"
package["dependencies"]["@domicile/electron-chrome-host"] = f"file:{host}"
with open(path, "w") as f:
    json.dump(package, f, indent=2)
PYTHON

if ! ( cd "$SHELL_DIR" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 bun install >"$WORK/install.log" 2>&1 ); then
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

# `bin/` names what runs, so the build has to have produced everything it
# reaches: the launcher it execs, the Electron main bundle the launcher starts,
# the preload that main names, and the page. A shell that builds but emits none
# of them still starts and shows a blank window — or nothing at all — which is
# a failure a green build does not show.
for artifact in \
  ".vite/build/launch.js" \
  ".vite/build/main.js" \
  ".vite/build/preload.cjs" \
  ".vite/renderer/main_window/index.html" \
  ".vite/build/package.json"; do
  if [ ! -f "$SHELL_DIR/$artifact" ]; then
    echo "FAIL: the build emitted no $artifact, which running the shell reaches. It has:"
    find "$SHELL_DIR/.vite" -type f 2>/dev/null | sed "s|$SHELL_DIR/|    |" | head -10
    exit 1
  fi
done

# The manifest exists for exactly one field, so its existence is not the claim
# — an empty file or one with mangled quoting passes `[ -f ]` and settles
# nothing about how Node parses the bundles beside it.
if ! grep -q '"type"' "$SHELL_DIR/.vite/build/package.json"; then
  echo "FAIL: .vite/build/package.json carries no \"type\", which is the only"
  echo "  reason it is shipped. It contains:"
  sed 's/^/    /' "$SHELL_DIR/.vite/build/package.json"
  exit 1
fi

# And the thing every other check here passes without: that the launcher can
# resolve its own imports with nothing beside it.
#
# This is the bug that shipped. `build.ssr` leaves real dependencies as bare
# imports unless `ssr.noExternal` says otherwise, and inside the workspace the
# SDK is symlinked source that gets bundled regardless — so a launcher missing
# that switch builds, typechecks, emits all five artifacts, and dies on its
# first import the moment it is installed somewhere without a `node_modules`.
# Moving the directory away is what makes this an *installed* shell rather
# than a built one.
#
# Run through `bun` rather than the stub: the stub execs
# `${DOMICILE_ELECTRON:-electron}`, and nothing else here needs an Electron.
# Bun rather than `node` for the same reason the rest of this script uses it —
# it is the one runtime already guarded for at the top, and it resolves
# `node_modules` the same way, so a machine with bun and no node gets this
# check rather than a FAIL blaming the shell for something about the machine.
# `/bin/false` as the compositor is how the launcher is made to fail on
# something *after* module resolution — reaching that error is the assertion.
echo
echo "== the launcher resolves its imports with no node_modules =="
mv "$SHELL_DIR/node_modules" "$SHELL_DIR/node_modules.away"
LAUNCHED="$(
  cd "$SHELL_DIR" \
    && DOMICILE_COMPOSITOR=/bin/false bun .vite/build/launch.js 2>&1 || true
)"
mv "$SHELL_DIR/node_modules.away" "$SHELL_DIR/node_modules"
case "$LAUNCHED" in
  *"the compositor never published a session"*)
    echo "PASS: it got as far as the compositor, so every import resolved"
    ;;
  *)
    echo "FAIL: the launcher did not reach its compositor with node_modules gone."
    echo "  A bare import here is a shell that cannot start once installed."
    echo "$LAUNCHED" | sed 's/^/    /' | head -8
    exit 1
    ;;
esac

# The stub is what a user runs and what an installed shell puts on `PATH`, so
# a shell whose `bin` entry is missing or unexecutable is one nothing can start
# — and `bun install` is what would have marked it executable for a consumer.
STUB="$SHELL_DIR/$(sed -n 's/.*"minimal": *"\.\/\([^"]*\)".*/\1/p' "$SHELL_DIR/package.json")"
if [ ! -x "$STUB" ]; then
  echo "FAIL: the example's bin entry is missing or not executable ($STUB)"
  exit 1
fi

echo "PASS: a shell outside this repo builds against the published SDK and emits everything running it reaches"
