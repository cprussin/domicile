#!/usr/bin/env bash
# Whether each patch in the engine series was made against the series, or
# against the bare pin.
#
# `apply.sh` runs `git am` over `patches/*.patch` in order, onto a checkout at
# CHROMIUM_PIN. So the tree patch 0011 lands on is not the pin: it is the pin
# plus 0001..0010. A patch regenerated in a scratch tree holding only the
# pinned file therefore has the right CONTENT and the wrong CONTEXT, and
# `git apply --check` against that same scratch tree says it is fine. It is
# not: on the runner it fails with "patch does not apply", after the tree lock,
# the reset and the whole series ahead of it — which is an hour of a shared
# machine to learn something a string comparison knows.
#
# That is not hypothetical. Patch 0010 turns `DidNotifySubtreeInsertionsToDocument`
# from `final` into `override` in html_frame_element_base.h, four lines of
# comment and all; 0011 edits the same header a few lines away. Regenerated
# against the pin, 0011's context still said `final` and still sat at the pin's
# line numbers, and engine run 191 died on it.
#
# WHAT SAYS SO WITHOUT A CHROMIUM TREE. Every `diff --git` in a `git
# format-patch` file carries `index <pre>..<post>`: the blob the patch expects
# to find, and the blob it leaves. For a file two patches both touch, the later
# patch's <pre> must be the earlier one's <post>. When a patch is regenerated
# against the wrong base that chain breaks, and the break names both ends.
#
# Hashes are abbreviated to whatever length the generating git chose, and the
# series has both 7 and 13 character forms in it, so they are compared on the
# shorter of the two prefixes. That cannot produce a false alarm: a prefix
# mismatch is a mismatch at full length too.
#
# A file only ONE patch touches has nothing to chain and is not checked here;
# its base is the pin, which is what it was made against.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || {
  echo "no patch series at $PATCHES" >&2
  exit 1
}

# Every (patch, file, pre, post), in series order. `index` is the line after
# the `diff --git` that names the file, so the two are read as a pair rather
# than matched up afterwards.
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
          # A regex, not a literal: awk treats a multi-character separator
          # as one, and an unescaped `..` matches ANY two characters -- which
          # splits the pair at every second column and quietly compares
          # rubbish that always agrees.
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

# A series where no file is touched twice has nothing to say, and would pass
# this silently forever while the check rotted. There are such handoffs today,
# so a count of zero is the test having stopped testing.
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
