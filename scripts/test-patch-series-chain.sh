#!/usr/bin/env bash
# Checks that each patch in the engine series was made against the series,
# not the bare pin.
#
# `apply.sh` runs `git am` over `patches/*.patch` in order, so patch N applies
# on the pin plus patches 1..N-1. A patch regenerated against the pin alone has
# the right content and the wrong context, and fails with "patch does not
# apply" on the runner after a long setup.
#
# Each `diff --git` carries `index <pre>..<post>`. For a file two patches
# touch, the later patch's <pre> must equal the earlier one's <post>.
#
# Hashes are abbreviated to 7 or 13 characters, so compare the shorter prefix.
# A prefix mismatch is also a full-length mismatch, so there are no false
# alarms.
#
# Files touched by only one patch have nothing to chain and are skipped.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || {
  echo "no patch series at $PATCHES" >&2
  exit 1
}

# Every (patch, file, pre, post), in series order. `index` follows the
# `diff --git` line that names the file.
READINGS="$(
  for patch in "$PATCHES"/*.patch; do
    awk -v name="$(basename "$patch")" '
      /^diff --git a\// {
        file = $3
        sub(/^a\//, "", file)
        next
      }
      /^index [0-9a-f]+\.\.[0-9a-f]+/ {
        if (file != "") {
          # A regex, not a string: awk treats an unescaped `..` as any two
          # characters, which splits the pair wrongly and always agrees.
          split($2, blobs, /\.\./)
          print name, file, blobs[1], blobs[2]
          file = ""
        }
      }
    ' "$patch"
  done
)"
[ -n "$READINGS" ] || {
  echo "no patches read out of $PATCHES — the series moved, or the format did." >&2
  exit 1
}

BROKEN=0
CHAINED=0
declare -A LEFT_BY LEFT_AT
while read -r patch file pre post; do
  previous="${LEFT_BY[$file]:-}"
  if [ -n "$previous" ]; then
    CHAINED=$((CHAINED + 1))
    # The shorter of the two abbreviations, so a 7 and a 13 compare as 7.
    length="${#previous}"
    [ "${#pre}" -lt "$length" ] && length="${#pre}"
    if [ "${previous:0:length}" != "${pre:0:length}" ]; then
      printf '  BROKEN %s\n' "$file"
      printf '    %s leaves it at %s\n' "${LEFT_AT[$file]}" "$previous"
      printf '    %s expects to find %s\n' "$patch" "$pre"
      printf '    so %s was made against a tree without %s in it.\n' \
        "$patch" "${LEFT_AT[$file]}"
      printf '    Regenerate it on the series, not on the pin.\n'
      BROKEN=$((BROKEN + 1))
    fi
  fi
  LEFT_BY["$file"]="$post"
  LEFT_AT["$file"]="$patch"
done <<<"$READINGS"

# The series has files touched twice, so zero handoffs means the check
# stopped reading them.
[ "$CHAINED" -gt 0 ] || {
  echo "no file in the series is touched by two patches, so nothing was checked." >&2
  echo "Either the series was flattened or the index lines stopped being read." >&2
  exit 1
}

if [ "$BROKEN" -eq 0 ]; then
  echo "every patch expects the file the patch before it left ($CHAINED handoffs)"
  exit 0
fi
echo "$BROKEN patch(es) made against the wrong base" >&2
exit 1
