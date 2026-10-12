#!/usr/bin/env bash
# Asserts that a packaged engine's PROVENANCE says which build it is.
#
# The checked build runs DCHECKs and the official one does not. The tarball is
# the only thing an integrator has, so it has to say which one it holds. The
# flavor comes from the build's own `args.gn`, and packaging stops when that
# is missing, unrecognized, or disagrees with `DOMICILE_ENGINE_BUILD`, which
# picks the release tag.
#
# The build directory is faked with empty files, and `zstd` with `cat`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="$ROOT/.github/scripts/engine-release-package.sh"
[ -x "$PACKAGE" ] || { echo "no $PACKAGE" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

BIN="$WORK/bin"
mkdir -p "$BIN"
printf '#!/bin/sh\nexec cat\n' >"$BIN/zstd"
chmod +x "$BIN/zstd"

CHROMIUM="$WORK/chromium"
OUT="out/Release"
BUILD="$CHROMIUM/$OUT"

fake_build() { # args.gn contents, or empty for none
  rm -rf "$CHROMIUM"
  mkdir -p "$BUILD/locales"
  for file in chrome icudtl.dat resources.pak chrome_100_percent.pak \
              libdomicile_engine.so; do
    : >"$BUILD/$file"
  done
  if [ -n "$1" ]; then
    printf '%s\n' "$1" >"$BUILD/args.gn"
  fi
}

gn_args() { # is_official_build, dcheck_always_on
  printf '  is_debug = false\n  is_official_build = %s\n  dcheck_always_on = %s\n' "$1" "$2"
}

# Prints the packaged PROVENANCE's build line, or `failed` if packaging failed.
package() { # extra env assignments...
  local stage="$WORK/stage" tarball
  rm -rf "$stage"
  if ( cd "$ROOT" && env "$@" PATH="$BIN:$PATH" GITHUB_OUTPUT= \
         "$PACKAGE" "$CHROMIUM" "$OUT" "$stage" ) >"$WORK/said" 2>&1; then
    tarball="$(ls "$stage"/*.tar.zst)"
    PATH="$BIN:$PATH" tar --zstd -xOf "$tarball" --wildcards '*/PROVENANCE' |
      sed -n 's/^build: *//p'
  else
    echo failed
  fi
}

echo "== the build says which flavor it is =="

fake_build "$(gn_args false true)"
expect "a checked build says so" \
  "checked (is_official_build = false, dcheck_always_on = true)" \
  "$(package -u DOMICILE_ENGINE_BUILD)"

fake_build "$(gn_args true false)"
expect "an official build says so" \
  "official (is_official_build = true, dcheck_always_on = false)" \
  "$(package DOMICILE_ENGINE_BUILD=official)"

echo
echo "== packaging stops when the flavor is in doubt =="

fake_build ""
expect "a build with no args.gn" failed "$(package -u DOMICILE_ENGINE_BUILD)"

fake_build "$(gn_args true true)"
expect "a build that is neither flavor" failed \
  "$(package DOMICILE_ENGINE_BUILD=official)"

# The publisher tags by DOMICILE_ENGINE_BUILD, so a mismatch would publish a
# checked engine under an official tag.
fake_build "$(gn_args false true)"
expect "a checked build packaged as official" failed \
  "$(package DOMICILE_ENGINE_BUILD=official)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "engine-release-package: all cases passed"
else
  echo "engine-release-package: $FAILED case(s) failed"
fi
exit "$FAILED"
