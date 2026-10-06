#!/usr/bin/env bash
# Write the commits on top of the pin in a Chromium checkout back to patches/.
# The inverse of apply.sh.
#
#   ./scripts/extract.sh /build/chromium/src
#
# New files for src/ must be copied by hand. Run this before every push.
set -u

SERIES="$(cd "$(dirname "$0")/.." && pwd)"
CHROMIUM="${1:-}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: extract.sh <path to chromium/src>" >&2
  exit 1
fi

PIN="$(grep -v '^#' "$SERIES/CHROMIUM_PIN" | tr -d '[:space:]')"

rm -rf "$SERIES/patches"
mkdir -p "$SERIES/patches"
git -C "$CHROMIUM" format-patch --no-signature --zero-commit --no-numbered \
  -o "$SERIES/patches" "$PIN..HEAD" >/dev/null || {
  echo "could not format patches against $PIN" >&2
  exit 1
}

echo "extracted $(find "$SERIES/patches" -name '*.patch' | wc -l) patch(es) to patches/"
echo "new files in src/ are yours to copy by hand: this cannot tell a new"
echo "source file from build output."
