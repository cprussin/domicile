#!/usr/bin/env bash
# Apply this series to a Chromium checkout: copy in `src/`, then `git am` the
# patches.
#
#   ./scripts/apply.sh /build/chromium/src
#
# Not idempotent: `git am` refuses a patch that is already applied. Refuses a
# dirty tree.
set -u

SERIES="$(cd "$(dirname "$0")/.." && pwd)"
CHROMIUM="${1:-}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: apply.sh <path to chromium/src>" >&2
  exit 1
fi

# In a worktree `.git` is a file, so test with `git rev-parse`.
if ! git -C "$CHROMIUM" rev-parse --git-dir >/dev/null 2>&1; then
  echo "$CHROMIUM is not a git checkout" >&2
  exit 1
fi

# The series only applies cleanly to the revision it was written against.
PIN="$(grep -v '^#' "$SERIES/CHROMIUM_PIN" | tr -d '[:space:]')"
HEAD="$(git -C "$CHROMIUM" rev-parse HEAD)"
if [ "${HEAD#"$PIN"}" = "$HEAD" ]; then
  echo "checkout is at $HEAD" >&2
  echo "series pins     $PIN" >&2
  echo "sync the checkout, or bump CHROMIUM_PIN and re-measure the rebase" >&2
  exit 1
fi

if [ -n "$(git -C "$CHROMIUM" status --porcelain)" ]; then
  echo "$CHROMIUM has uncommitted changes; clean it before applying" >&2
  exit 1
fi

# New files never conflict. See docs/architecture/ENGINE-FORK.md.
if [ -n "$(ls -A "$SERIES/src" 2>/dev/null | grep -v '^\.gitkeep$')" ]; then
  echo "laying in new files..."
  cp -r "$SERIES/src/." "$CHROMIUM/"
fi

# Edits to Chromium's own files. These are what a pin bump can reject.
PATCHES="$(find "$SERIES/patches" -name '*.patch' | sort)"
if [ -n "$PATCHES" ]; then
  echo "applying patches..."
  # shellcheck disable=SC2086
  git -C "$CHROMIUM" am --keep-non-patch $PATCHES || {
    echo >&2
    echo "a patch did not apply. Resolve it in $CHROMIUM, then:" >&2
    echo "  git -C $CHROMIUM am --continue" >&2
    echo "and regenerate the series with ./scripts/extract.sh" >&2
    exit 1
  }
fi

echo "series applied to $CHROMIUM"
