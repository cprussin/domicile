#!/usr/bin/env bash
# Whether every Blink variant the fork asks a mojom target for is one that
# target actually generates.
#
# A `mojom()` target does not produce one library. It produces one per variant,
# and the Blink half of the fork links against `:<name>_blink` rather than
# `:<name>` -- different typemaps, `WTF::String` where the default bindings
# have `std::string`. Those variant targets exist only if the mojom template
# was asked to emit them.
#
# THE DEFAULT INVERTED UNDER US, which is the whole reason this exists. Until
# `3d77360` the template emitted the Blink variant for every target unless one
# opted out with `disable_variants`; now it emits it only for a target that
# opts IN with `generate_blink = true`:
#
#     -  if ((!defined(invoker.disable_variants) || !invoker.disable_variants) &&
#     -      use_blink) {
#     +  generate_blink = false
#     +  if (defined(invoker.generate_blink)) {
#     +    generate_blink = invoker.generate_blink
#     +  }
#     +  if (generate_blink && use_blink) {
#
# `components/domicile/mojom` said neither, so it silently stopped generating
# `:mojom_blink` and three Blink targets that name it stopped resolving. That
# cost a full cycle on the shared tree, and it is not a class the override
# audit in this same pull request can see: nothing in C++ changed, no patch
# rejected, and `git am` applied all thirty-six without a word. A GN default
# moved, and a GN default is invisible to every check that reads source.
#
# It is also not a compile error. `gn gen` refuses before a single file is
# compiled -- "Unresolved dependencies" -- so the build does not start, and
# what the cost buys is one line of output eight minutes in.
#
# So: read every `_blink` reference the fork makes, and for the ones naming a
# mojom target the fork itself owns, require that target to opt in. An
# upstream target's opt-in is upstream's to keep; this reports those and
# checks the fork's own.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERIES="$ROOT/packages/domicile-engine"
SRC="$SERIES/src"

[ -d "$SRC" ] || { echo "no $SRC" >&2; exit 1; }
[ -d "$SERIES/patches" ] || { echo "no $SERIES/patches" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# Every `//path:name_blink` the fork names, from both registries it can be
# named in: a `BUILD.gn` that `src/` copies into the checkout, and an added
# line in a patch hunk. Both are the fork asking for a variant, and a scan that
# read only one of them would have missed two of this bug's three call sites.
blink_refs() {
  {
    grep -rhoE '//[A-Za-z0-9_/.-]+:[A-Za-z0-9_-]+_blink' "$SRC" --include=BUILD.gn --include='*.gni' 2>/dev/null
    grep -rhoE '^\+.*//[A-Za-z0-9_/.-]+:[A-Za-z0-9_-]+_blink' "$SERIES"/patches/*.patch 2>/dev/null |
      grep -oE '//[A-Za-z0-9_/.-]+:[A-Za-z0-9_-]+_blink'
  } | sort -u
}

# Whether a top-level `mojom("x")` or `mojom_component("x")` in this file opts
# into the Blink variant. Both spellings, because the targets this fork depends
# on use each -- `//mojo/public/mojom/base` is a component and
# `//ui/gfx/mojom` is not -- and a reader that knew only `mojom(` would call a
# component's opt-in missing.
declares_generate_blink() {
  awk -v n="$2" '
    $0 ~ "^mojom(_component)?\\(\"" n "\"\\)" { inside = 1; next }
    inside && /^\}/ { inside = 0 }
    inside && /generate_blink[[:space:]]*=[[:space:]]*true/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$1"
}

REFS="$(blink_refs)"

# THE POSITIVE FIRST. An empty list passes every assertion below vacuously, and
# an empty list is exactly what a moved directory, a renamed patch or a
# reformatted dependency block produces -- the same green silence as the bug.
if [ -z "$REFS" ]; then
  echo "no :<name>_blink references found in $SRC or the patch series" >&2
  echo "either the fork stopped using Blink bindings, or this script has stopped reading them" >&2
  exit 1
fi

echo "the fork names $(printf '%s\n' "$REFS" | wc -l) blink variant(s):"

for ref in $REFS; do
  path="${ref%%:*}"
  path="${path#//}"
  target="${ref##*:}"
  base="${target%_blink}"
  build_gn="$SRC/$path/BUILD.gn"

  if [ ! -f "$build_gn" ]; then
    # Upstream's target, and upstream's opt-in to keep. There is no Chromium
    # checkout here to read it out of, so this is reported rather than judged:
    # claiming it checked would be the vacuous pass this script exists to
    # refuse.
    printf '  --    %s is upstream'"'"'s (no %s in the series)\n' "$ref" "src/$path/BUILD.gn"
    continue
  fi

  if declares_generate_blink "$build_gn" "$base"; then
    ok "$ref is generated: $path/BUILD.gn opts in"
  else
    fail "$ref is generated: $path/BUILD.gn opts in" \
      "mojom(\"$base\") there does not set generate_blink = true, so the template emits no blink variant and gn gen fails with \"Unresolved dependencies\" before anything compiles"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
