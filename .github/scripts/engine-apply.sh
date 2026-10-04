#!/usr/bin/env bash
# Apply the patch series over the pin, and assert that it went on.
#
#   .github/scripts/engine-apply.sh <path to chromium/src>
#
# Runs outside Chromium's shell. `apply.sh` needs only git, grep, cp and find,
# and the shell's sandbox hides the exit status and output.
#
# `git am` commits each patch, so a HEAD still at the pin means nothing applied.
set -euo pipefail

CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || {
  echo "usage: engine-apply.sh <path to chromium/src>" >&2
  exit 2
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

pin="$(grep -v '^#' packages/domicile-engine/CHROMIUM_PIN | tr -d '[:space:]')"
packages/domicile-engine/scripts/apply.sh "$CHROMIUM"
[ "$(git -C "$CHROMIUM" rev-parse HEAD)" != "$pin" ] || {
  echo "::error::apply.sh succeeded but the checkout is still at the pin, so no patch was applied" >&2
  exit 1
}
echo "series applied: $(git -C "$CHROMIUM" log --oneline "$pin..HEAD" | wc -l) patches"
