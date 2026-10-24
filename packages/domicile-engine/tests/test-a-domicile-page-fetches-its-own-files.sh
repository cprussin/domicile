#!/usr/bin/env bash
# Checks that a domicile:// document can fetch() its own files and that only
# its own origin can read them.
#
# Blink refuses fetch() on a scheme outside its Fetch API set before any loader
# sees the request, so the splash's fetch("progress.json") failed and it never
# left "Getting ready". Registering the scheme lets every page reach
# `ShellURLLoaderFactory`, which every frame uses, so the factory must refuse
# other origins.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group. `guard-domicile-fetch.sh` checks the same on a built engine.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
FACTORY="$ENGINE/src/components/domicile/browser/shell_url_loader_factory.cc"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }
[ -f "$FACTORY" ] || { echo "no factory at $FACTORY" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

added="$(cat "$PATCHES"/*.patch 2>/dev/null | grep -a '^+' || true)"
in_patches() { case "$added" in (*"$1"*) return 0 ;; (*) return 1 ;; esac }

if in_patches "RegisterURLSchemeAsSupportingFetchAPI(" &&
  in_patches "WebString::FromAscii(domicile::kDomicileScheme)"; then
  ok "the renderer registers domicile:// as supporting fetch()"
else
  fail "the renderer registers domicile:// as supporting fetch()" \
    "no patch calls WebSecurityPolicy::RegisterURLSchemeAsSupportingFetchAPI for domicile::kDomicileScheme, so fetch() on the shell's own files fails"
fi

RENDERER_BUILD="$(grep -al '^+++ b/chrome/renderer/BUILD.gn' "$PATCHES"/*.patch)"
if [ -n "$RENDERER_BUILD" ] &&
  # shellcheck disable=SC2086 # one path per patch
  grep -aqx '+    "//components/domicile:common",' $RENDERER_BUILD; then
  ok "chrome/renderer depends on the scheme's constant"
else
  fail "chrome/renderer depends on the scheme's constant" \
    "no patch adds //components/domicile:common to chrome/renderer/BUILD.gn"
fi

if grep -q 'MayReadFiles(request.mode, request.request_initiator' "$FACTORY"; then
  ok "the factory serves the shell's and an app's files only to their origin"
else
  fail "the factory serves the shell's and an app's files only to their origin" \
    "CreateLoaderAndStart does not call MayReadFiles, so any page fetch()es the shell's files"
fi

if grep -qx '  guard-domicile-fetch' "$ROOT/packages/domicile-engine/scripts/run-checks.sh"; then
  ok "test:engine runs guard-domicile-fetch.sh"
else
  fail "test:engine runs guard-domicile-fetch.sh" \
    "run-checks.sh does not list guard-domicile-fetch"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
