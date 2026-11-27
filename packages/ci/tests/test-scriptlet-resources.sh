#!/usr/bin/env bash
# Tests `scriptlet-resources.sh` and `scriptlet-resources.ts`, which build
# uBlock Origin's scriptlets and redirect stand-ins as the resources file the
# engine fetches and check it is the one the config pins.
#
# Runs against a checkout laid out as uBlock Origin's, with scriptlets of its
# own, so nothing of uBlock Origin's runs here:
#
#   - each scriptlet becomes a resource, its source in base64, a `.fn` one as a
#     helper, sorted by name, with its aliases and dependencies.
#   - one that needs a trusted list is left out; one of the isolated world is
#     kept.
#   - one whose helper was left out fails the build.
#   - each stand-in redirect-resources.js names becomes a resource, its file
#     in base64, its type by its extension, with its aliases; one that needs a
#     trusted list or parameters is left out, and one whose file is missing,
#     or that a scriptlet already names, fails.
#   - the same checkout builds the same file.
#   - a build that is not the pin fails, and says the hash to pin.
#   - a pin of another version fails before it builds.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/.github/scripts/scriptlet-resources.sh"
[ -x "$SCRIPT" ] || { echo "no $SCRIPT" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}
check() { # what, then a command that must succeed
  local what="$1"
  shift
  if "$@"; then ok "$what"; else fail "$what" "$*"; fi
}

checkout() { # $1 directory, $2 the scriptlets' module body, $3 the redirects' (a noop.js unless given)
  mkdir -p "$1/src/js/resources" "$1/src/web_accessible_resources"
  printf '%s\n' "$2" >"$1/src/js/resources/scriptlets.js"
  local redirects='export default new Map([["noop.js", { alias: "noopjs" }]]);'
  printf '%s\n' "${3:-$redirects}" >"$1/src/js/redirect-resources.js"
  printf '%s\n' '(function() {})();' >"$1/src/web_accessible_resources/noop.js"
}

checkout "$WORK/ubo" '
import { safeSelf } from "./safe-self.js";
export const builtinScriptlets = [];
function setConstant(name, value) { safeSelf(); window[name] = value; }
function trustedSet(name) { window[name] = 1; }
function isolated() {}
builtinScriptlets.push({ name: "set-constant.js", aliases: ["set.js"], fn: setConstant, dependencies: ["safe-self.fn"] });
builtinScriptlets.push({ name: "trusted-set.js", fn: trustedSet, requiresTrust: true });
builtinScriptlets.push({ name: "isolated.js", fn: isolated, world: "ISOLATED" });
builtinScriptlets.push({ name: "safe-self.fn", fn: safeSelf });
' '
export default new Map([
  ["1x1.gif", { alias: "1x1-transparent.gif", data: "blob" }],
  ["noop.js", { alias: ["noopjs", "abp-resource:blank-js"], data: "text" }],
  ["empty", { data: "text" }],
  ["trusted.js", { requiresTrust: true }],
  ["click2load.html", { params: ["aliasURL", "url"] }],
]);'
printf '%s\n' 'export function safeSelf() { return 1; }' >"$WORK/ubo/src/js/resources/safe-self.js"
printf 'GIF89a' >"$WORK/ubo/src/web_accessible_resources/1x1.gif"
: >"$WORK/ubo/src/web_accessible_resources/empty"

pin() { # $1 version, $2 sha256
  printf 'pub const DEFAULT_SCRIPTLET_RESOURCES: &str = "https://github.com/cprussin/domicile-builds/releases/download/ublock-origin-resources-%s/resources.json#sha256=%s";\n' \
    "$1" "$2" >"$WORK/lib.rs"
}
VERSION="$(sed -n 's/^UBO_VERSION=//p' "$SCRIPT")"

echo "the build"
mkdir "$WORK/out"
bun "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/ubo" "$WORK/out/a.json" >/dev/null
bun "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/ubo" "$WORK/out/b.json" >/dev/null
BUILT="$(bun -e '
  const resources = JSON.parse(await Bun.file(process.argv[1]).text());
  console.log(resources.map((r) =>
    [r.name, r.aliases.join(","), r.kind.mime, atob(r.content), r.dependencies.join(",")].join(" | ")
  ).join("\n"));
' "$WORK/out/a.json")"
# bun prints a function's source its own way, so each is read as one line.
BUILT="$(tr -s ' \n' ' ' <<<"$BUILT" | sed 's/ \(1x1\.gif\|empty\|isolated\.js\|noop\.js\|safe-self\.fn\|set-constant\.js\) | /\n\1 | /g')"
check "a stand-in image comes first, by name, with its alias" \
  grep -qE '^1x1\.gif \| 1x1-transparent\.gif \| image/gif \| GIF89a \| *$' <<<"$(sed -n 1p <<<"$BUILT")"
check "a stand-in without an extension is text" \
  grep -qE '^empty \| \| text/plain \| *\| *$' <<<"$(sed -n 2p <<<"$BUILT")"
check "one of the isolated world is kept, by name" \
  grep -qE '^isolated\.js \| \| application/javascript \| function isolated\(\) \{' <<<"$(sed -n 3p <<<"$BUILT")"
check "a stand-in script keeps its aliases, sorted, and its file" \
  grep -qE '^noop\.js \| abp-resource:blank-js,noopjs \| application/javascript \| \(function\(\) \{\}\)\(\); \| *$' <<<"$(sed -n 4p <<<"$BUILT")"
check "a helper is kept, by name, as fn/javascript" \
  grep -qE '^safe-self\.fn \| \| fn/javascript \| function safeSelf\(\) \{ return 1; \} \| *$' <<<"$(sed -n 5p <<<"$BUILT")"
check "a scriptlet keeps its aliases, its source and its helper" \
  grep -qE '^set-constant\.js \| set\.js \| application/javascript \| function setConstant\(name, value\) \{ safeSelf\(\); window\[name\] = value; \} \| safe-self\.fn *$' <<<"$(sed -n 6p <<<"$BUILT")"
check "those that need a trusted list or parameters are left out" \
  test "$(grep -c . <<<"$BUILT")" -eq 6
check "the same checkout builds the same file" cmp -s "$WORK/out/a.json" "$WORK/out/b.json"

checkout "$WORK/orphan" '
export const builtinScriptlets = [];
function a() {}
function helper() {}
builtinScriptlets.push({ name: "a.js", fn: a, dependencies: ["helper.fn"] });
builtinScriptlets.push({ name: "helper.fn", fn: helper, requiresTrust: true });
'
check "a scriptlet whose helper was left out fails" \
  bash -c '! bun "$1" "$2" "$3" 2>"$4" && grep -q "depends on helper.fn" "$4"' _ \
  "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/orphan" "$WORK/out/c.json" "$WORK/err"

checkout "$WORK/missing" 'export const builtinScriptlets = [{ name: "a.js", fn: function a() {} }];' \
  'export default new Map([["gone.js", {}]]);'
check "a stand-in whose file is missing fails" \
  bash -c '! bun "$1" "$2" "$3" 2>"$4" && grep -q "gone.js is named but" "$4"' _ \
  "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/missing" "$WORK/out/e.json" "$WORK/err"

checkout "$WORK/twice" 'export const builtinScriptlets = [{ name: "noop.js", fn: function a() {} }];'
check "a stand-in a scriptlet already names fails" \
  bash -c '! bun "$1" "$2" "$3" 2>"$4" && grep -q "both a scriptlet and a stand-in" "$4"' _ \
  "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/twice" "$WORK/out/f.json" "$WORK/err"

checkout "$WORK/noredirects" 'export const builtinScriptlets = [{ name: "a.js", fn: function a() {} }];' \
  'export const other = 1;'
check "a checkout without redirect resources fails" \
  bash -c '! bun "$1" "$2" "$3" 2>"$4" && grep -q "exports no Map of redirect resources" "$4"' _ \
  "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/noredirects" "$WORK/out/g.json" "$WORK/err"

checkout "$WORK/none" 'export const other = [];'
check "a checkout without builtinScriptlets fails" \
  bash -c '! bun "$1" "$2" "$3" 2>"$4" && grep -q "exports no builtinScriptlets" "$4"' _ \
  "$ROOT/.github/scripts/scriptlet-resources.ts" "$WORK/none" "$WORK/out/d.json" "$WORK/err"

echo
echo "the pin"
export SCRIPT WORK
HASH="$(sha256sum "$WORK/out/a.json" | cut -d' ' -f1)"
pin "$VERSION" "$HASH"
run() { # then the script's arguments
  env UBO_CHECKOUT="${UBO_CHECKOUT:-$WORK/ubo}" SCRIPTLETS_CONFIG="$WORK/lib.rs" \
    SCRIPTLETS_PUBLISHED="${PUBLISHED:-none}" "$SCRIPT" "$@"
}
check "an unpublished build that is the pin passes" \
  bash -c "$(declare -f run); run >/dev/null"
pin "$VERSION" "$(printf '0%.0s' $(seq 64))"
refused() { # what, what the refusal must say
  if run >/dev/null 2>"$WORK/err"; then
    fail "$1" "it passed"
  elif grep -q -- "$2" "$WORK/err"; then
    ok "$1"
  else
    fail "$1" "it said: $(cat "$WORK/err")"
  fi
}
refused "a build that is not the pin fails, and names the hash to pin" "sha256=$HASH"
PUBLISHED="$WORK/out/a.json" refused "a published file that is not the pin fails" "is $HASH, not the pinned"
pin "$VERSION" "$HASH"
check "a published file that is the pin passes, unbuilt" \
  bash -c "$(declare -f run); UBO_CHECKOUT=/nonexistent PUBLISHED='$WORK/out/a.json' run | grep -q 'is published, and is the pin'"
pin "0.0.1" "$HASH"
refused "a pin of another version fails" "bump UBO_VERSION"
check "the repository's pin is this version's" \
  grep -q "ublock-origin-resources-$VERSION/resources.json#sha256=" "$ROOT/packages/domicile-config/src/lib.rs"

echo
if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "the scriptlets and stand-ins build and check their pin"
