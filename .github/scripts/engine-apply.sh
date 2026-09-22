#!/usr/bin/env bash
# Apply the patch series over the pin, and assert that it went on.
#
#   .github/scripts/engine-apply.sh <path to chromium/src>
#
# NOT through Chromium's shell, and that was a mistake worth naming. This used
# to enter it with NIX_SHELL_RUN, copied from the build step without asking
# whether it needed to. `apply.sh` is `git`, `grep`, `cp` and `find` — every one
# of them already on the runner's PATH, and not one a Chromium host tool. What
# the wrapper bought was a sandbox that swallowed the script's exit status AND
# its output: five runs failed here saying nothing, and three more were spent
# building instruments to find out what.
#
# Run directly, the exit status is the caller's and the error is in its log. The
# HEAD check stays anyway: `git am` commits each patch, so a HEAD still at the
# pin means the series did not go on, and that is worth asserting rather than
# inferring from an exit code.
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
