#!/usr/bin/env bash
# Lay this series onto a Chromium checkout: copy in the new files, then apply
# the patches that edit existing ones.
#
#   ./scripts/apply.sh /build/chromium/src
#
# Idempotent for `src/` (a copy), not for `patches/` (a `git am` refuses to
# apply a patch twice). Re-running on a dirty tree is the caller's problem —
# this refuses rather than guessing.
set -u

SERIES="$(cd "$(dirname "$0")/.." && pwd)"
CHROMIUM="${1:-}"

if [ -z "$CHROMIUM" ]; then
  echo "usage: apply.sh <path to chromium/src>" >&2
  exit 1
fi

# `git rev-parse` rather than testing for a `.git` directory: in a worktree
# `.git` is a file, and a worktree at the pin is the cheapest way to check that
# the series still applies without disturbing the built tree.
if ! git -C "$CHROMIUM" rev-parse --git-dir >/dev/null 2>&1; then
  echo "$CHROMIUM is not a git checkout" >&2
  exit 1
fi

# The pin is the whole reason this is reproducible. A series applied to a
# revision it was not written against is how a fork silently rots.
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

# New files first. Most of this fork is additive — see
# docs/architecture/ENGINE-FORK.md — so this is the bulk of it and it never
# conflicts.
if [ -n "$(ls -A "$SERIES/src" 2>/dev/null | grep -v '^\.gitkeep$')" ]; then
  echo "laying in new files..."
  cp -r "$SERIES/src/." "$CHROMIUM/"
fi

# Then the edits to files Chromium already owns. These are what a rebase can
# reject, and counting the rejects is the measurement the design doc asks for.
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
