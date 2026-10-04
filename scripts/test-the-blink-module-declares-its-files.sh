#!/usr/bin/env bash
# Checks that every file in the fork's Blink directories is registered where
# the build looks for it.
#
# - `modules/domicile/`: a `.cc` or `.h` builds only if the module's `BUILD.gn`
#   lists it, and an `.idl` generates bindings only if a patch adds it to
#   `bindings/idl_in_modules.gni`.
# - `core/html/domicile/`: core has no BUILD.gn of its own, so patches must add
#   sources to `core/html/build.gni` and idls to `bindings/idl_in_core.gni`.
#
# A missing entry is not a build error. The file is skipped, the build is
# green, and the interface is missing at runtime. This repo cannot build
# Chromium, so the check reads `src/` and the patch series.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERIES="$ROOT/packages/domicile-engine"
MODULE="$SERIES/src/third_party/blink/renderer/modules/domicile"
BUILD_GN="$MODULE/BUILD.gn"
CORE="$SERIES/src/third_party/blink/renderer/core/html/domicile"

[ -d "$MODULE" ] || { echo "no $MODULE" >&2; exit 1; }
[ -f "$BUILD_GN" ] || { echo "no $BUILD_GN" >&2; exit 1; }
[ -d "$CORE" ] || { echo "no $CORE" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# Every `.idl` the series adds to `idl_in_modules.gni`, read from that file's
# hunks only. The same path appears in other files, which would credit a
# missing registration.
registered_idls() {
  awk '
    /^diff --git a\// { in_gni = ($0 ~ /idl_in_modules\.gni$/) }
    in_gni && /^\+[[:space:]]*"\/\/third_party\/blink\/renderer\/modules\/domicile\// {
      if (match($0, /[^\/"]+\.idl/)) {
        print substr($0, RSTART, RLENGTH)
      }
    }
  ' "$SERIES"/patches/*.patch | sort -u
}

# The same for core, against `idl_in_core.gni`. Kept separate so a file
# registered in the wrong list is not credited.
core_registered_idls() {
  awk '
    /^diff --git a\// { in_gni = ($0 ~ /idl_in_core\.gni$/) }
    in_gni && /^\+[[:space:]]*"\/\/third_party\/blink\/renderer\/core\/html\/domicile\// {
      if (match($0, /[^\/"]+\.idl/)) {
        print substr($0, RSTART, RLENGTH)
      }
    }
  ' "$SERIES"/patches/*.patch | sort -u
}

# Sources a patch adds to `core/html/build.gni`, with the `domicile/` prefix
# dropped to compare against the directory listing.
core_declared_sources() {
  awk '
    /^diff --git a\// { in_gni = ($0 ~ /core\/html\/build\.gni$/) }
    in_gni && /^\+[[:space:]]*"domicile\// {
      if (match($0, /[^\/"]+\.(cc|h)/)) {
        print substr($0, RSTART, RLENGTH)
      }
    }
  ' "$SERIES"/patches/*.patch | sort -u
}

# The `sources = [ ... ]` list of the module's `blink_modules_sources` target,
# one quoted name per line.
declared_sources() {
  awk '
    /^[[:space:]]*sources = \[/ { inside = 1; next }
    inside && /^[[:space:]]*\]/ { inside = 0 }
    inside && match($0, /"[^"]+"/) {
      print substr($0, RSTART + 1, RLENGTH - 2)
    }
  ' "$BUILD_GN" | sort -u
}

# An empty registry or empty module would pass vacuously, as a renamed patch,
# reformatted gni or moved directory would cause.
REGISTERED="$(registered_idls)"
DECLARED="$(declared_sources)"
IDLS="$(cd "$MODULE" && ls ./*.idl 2>/dev/null | sed 's|^\./||')"
SOURCES="$(cd "$MODULE" && ls ./*.cc ./*.h 2>/dev/null | sed 's|^\./||')"

if [ -z "$REGISTERED" ]; then
  echo "no domicile idls found in the series' idl_in_modules.gni hunks" >&2
  echo "either nothing is registered, or this script has stopped reading them" >&2
  exit 1
fi
if [ -z "$DECLARED" ]; then
  echo "no sources found in $BUILD_GN" >&2
  exit 1
fi
if [ -z "$IDLS" ] || [ -z "$SOURCES" ]; then
  echo "no .idl or no .cc/.h under $MODULE" >&2
  exit 1
fi

echo "the module holds $(printf '%s\n' "$IDLS" | wc -l) idl(s) and $(printf '%s\n' "$SOURCES" | wc -l) source(s):"

for idl in $IDLS; do
  if printf '%s\n' "$REGISTERED" | grep -qxF "$idl"; then
    ok "$idl is registered in idl_in_modules.gni"
  else
    fail "$idl is registered in idl_in_modules.gni" \
      "no patch adds \"//third_party/blink/renderer/modules/domicile/$idl\", so Blink generates no bindings for it and the interface is absent from the page"
  fi
done

for source in $SOURCES; do
  if printf '%s\n' "$DECLARED" | grep -qxF "$source"; then
    ok "$source is declared in BUILD.gn"
  else
    fail "$source is declared in BUILD.gn" \
      "the module's blink_modules_sources target does not list it, so it is never compiled"
  fi
done

CORE_REGISTERED="$(core_registered_idls)"
CORE_DECLARED="$(core_declared_sources)"
CORE_IDLS="$(cd "$CORE" && ls ./*.idl 2>/dev/null | sed 's|^\./||')"
CORE_SOURCES="$(cd "$CORE" && ls ./*.cc ./*.h 2>/dev/null | sed 's|^\./||')"

# Both of these read patch hunks, so check they are non-empty too.
if [ -z "$CORE_REGISTERED" ]; then
  echo "no domicile idls found in the series' idl_in_core.gni hunks" >&2
  echo "either nothing is registered, or this script has stopped reading them" >&2
  exit 1
fi
if [ -z "$CORE_DECLARED" ]; then
  echo "no domicile sources found in the series' core/html/build.gni hunks" >&2
  echo "either nothing is declared, or this script has stopped reading them" >&2
  exit 1
fi
if [ -z "$CORE_IDLS" ] || [ -z "$CORE_SOURCES" ]; then
  echo "no .idl or no .cc/.h under $CORE" >&2
  exit 1
fi

echo
echo "core/html/domicile holds $(printf '%s\n' "$CORE_IDLS" | wc -l) idl(s) and $(printf '%s\n' "$CORE_SOURCES" | wc -l) source(s):"

for idl in $CORE_IDLS; do
  if printf '%s\n' "$CORE_REGISTERED" | grep -qxF "$idl"; then
    ok "$idl is registered in idl_in_core.gni"
  else
    fail "$idl is registered in idl_in_core.gni" \
      "no patch adds \"//third_party/blink/renderer/core/html/domicile/$idl\", so Blink generates no bindings for it and the interface is absent from the page"
  fi
done

for source in $CORE_SOURCES; do
  if printf '%s\n' "$CORE_DECLARED" | grep -qxF "$source"; then
    ok "$source is declared in core/html/build.gni"
  else
    fail "$source is declared in core/html/build.gni" \
      "no patch adds \"domicile/$source\" to blink_core_sources_html, so it is never compiled"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
