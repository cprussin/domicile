#!/usr/bin/env bash
# List the files this series would change in a checkout at its pin.
#
#   .github/scripts/engine-series-diff.sh <chromium/src>
#
# Prints checkout-relative paths, one per line, sorted. Exits non-zero when the
# checkout cannot be read, such as one not at this series' pin.
#
# Only a heuristic: engine-tree-pool.sh `compiles` uses it to guess whether a
# compile is cold, and a wrong guess only picks a slower queue.
#
# Compares files, not patches, since a rebased series rewrites patches without
# changing files. A patched file is compared by the blob hash in its last
# patch's `index` line. A file the checkout patches and the series does not
# counts as changed. Laid-down files are compared by content. A laid-down file
# the series dropped is not detected.
set -euo pipefail

CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || {
  echo "usage: $(basename "$0") <chromium/src>" >&2
  exit 2
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PACKAGE="$ROOT/packages/domicile-engine"
PATCHES="$PACKAGE/patches"
SERIES="$PACKAGE/src"
PIN="$(grep -v '^#' "$PACKAGE/CHROMIUM_PIN" | tr -d '[:space:]')"

# Each file the patches touch and its final blob; the last patch wins. No
# `xargs` or `cmp`, which the runner lacks.
patched() {
  find "$PATCHES" -name '*.patch' | LC_ALL=C sort |
    while IFS= read -r patch; do cat "$patch"; done |
    awk '/^diff --git / { path = substr($4, 3) }
         /^index / { split($2, blob, /\.\./); final[path] = blob[2] }
         END { for (path in final) print path, final[path] }'
}

wanted="$(patched)"
touched="$(git -C "$CHROMIUM" diff --name-only "$PIN" HEAD)"

{
  printf '%s\n' "$wanted" | while read -r path blob; do
    [ -n "$path" ] || continue
    have="$(git -C "$CHROMIUM" rev-parse -q --verify "HEAD:$path" || true)"
    case "$blob" in
      (*[!0]*) case "$have" in ("$blob"*) ;; (*) echo "$path" ;; esac ;;
      (*) [ -z "$have" ] || echo "$path" ;;
    esac
  done
  printf '%s\n' "$touched" | grep -vxF -f <(printf '%s\n' "$wanted" | cut -d' ' -f1) || true
  if [ -d "$SERIES" ]; then
    (cd "$SERIES" && find . -type f | sed 's|^\./||') | while IFS= read -r file; do
      [ -f "$CHROMIUM/$file" ] &&
        [ "$(git hash-object "$SERIES/$file")" = "$(git hash-object "$CHROMIUM/$file")" ] ||
        echo "$file"
    done
  fi
} | sed '/^$/d' | LC_ALL=C sort -u
