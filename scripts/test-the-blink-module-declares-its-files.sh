#!/usr/bin/env bash
# Whether every file in the fork's Blink module is declared where the build
# looks for it.
#
# The module at `src/third_party/blink/renderer/modules/domicile/` is the whole
# of the page's surface, and nothing in it is compiled because it is there. A
# `.cc` or `.h` is built only if the module's own `BUILD.gn` lists it, and an
# `.idl` generates bindings only if `bindings/idl_in_modules.gni` names it --
# and that file is Chromium's, so it is carried by the patch series rather than
# by `src/`. Two registries, in two different places, one of which is a diff.
#
# AND THE FORK'S OTHER BLINK DIRECTORY, `core/html/domicile/`, where BOTH
# registries are diffs: the elements and the event beside them live in core,
# which has no BUILD.gn of its own to add a file to -- core's source list is
# `core/html/build.gni` and its idl list is `bindings/idl_in_core.gni`, and
# both are Chromium's. So a file there is compiled only because a patch says
# so, twice over, and the same green build with nothing in the page is what an
# omission looks like.
#
# Neither omission is a compile error. A `.cc` nobody lists just is not built,
# and an `.idl` nobody registers just generates nothing: the interface is
# absent from the page at runtime and the build is green. The cost of finding
# that out is an engine release -- about four hours cold, twenty-six minutes on
# CI -- because this repo cannot build Chromium at all, which is exactly why
# the check has to be readable off the series instead.
#
# So: read the module's directory, and require each file to appear in the
# registry that governs its kind.
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

# Every `.idl` the series adds to `idl_in_modules.gni`, read out of that file's
# own hunks. Scoped to it: the same path appears in `BUILD.gn` and in
# `generated_in_modules.gni` under a different spelling, and reading every diff
# at once would credit a registration that never happened.
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

# The same reading for core, against `idl_in_core.gni`. A separate function
# rather than a parameter, because the two lists are separate registries and a
# reader that took either would credit a file registered in the wrong one.
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

# And what core compiles, which is a diff rather than a file in `src/`: the
# names as `core/html/build.gni` carries them, relative to that file's own
# directory -- `domicile/html_web_view_element.cc` -- with the directory
# dropped so they can be compared against the module's own listing.
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

# The `sources` list of the module's `blink_modules_sources` target: from
# `sources = [` to the `]` that closes it, one quoted name per line.
declared_sources() {
  awk '
    /^[[:space:]]*sources = \[/ { inside = 1; next }
    inside && /^[[:space:]]*\]/ { inside = 0 }
    inside && match($0, /"[^"]+"/) {
      print substr($0, RSTART + 1, RLENGTH - 2)
    }
  ' "$BUILD_GN" | sort -u
}

# THE POSITIVE FIRST, twice over: an empty registry passes every name below
# vacuously, and so does an empty module. A renamed patch, a reformatted gni
# block or a moved directory would each turn this into a green no-op, which is
# the same silence the omission it guards against arrives in.
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

# THE POSITIVE FIRST HERE TOO, and it earns it more than above: both of these
# read patch hunks, so a renamed patch or a reformatted list turns the whole
# section into a green no-op with nothing said.
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
