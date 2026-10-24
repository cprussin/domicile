#!/usr/bin/env bash
# Commits docs/media, as `packages/site/scripts/docs-media.sh` left it, onto a branch.
#
#   .github/scripts/docs-media-writeback.sh <branch>
#
# `docs-media.yml` captures from the branch tip, so this commits there. It
# never pushes to a branch the repository releases from.
set -euo pipefail

BRANCH="${1:-}"
[ -n "$BRANCH" ] || { echo "usage: $(basename "$0") <branch>" >&2; exit 2; }
case "$BRANCH" in
  main | stable | release)
    echo "::error::$BRANCH is protected; retake the media on a branch and open a pull request" >&2
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# The runner's HOME (and git config) is wiped on start.
export GIT_AUTHOR_NAME="domicile CI"
export GIT_AUTHOR_EMAIL="ci@domicile.invalid"
export GIT_COMMITTER_NAME="domicile CI"
export GIT_COMMITTER_EMAIL="ci@domicile.invalid"

git add -A docs/media
# Skip an empty commit, which would re-run every check on the pull request.
if git diff --cached --quiet; then
  echo "docs/media is unchanged; nothing to push"
  exit 0
fi
git commit -q -m "Retake docs media" -m "Captured on crux by docs-media.yml run $GITHUB_RUN_ID."

# Runs started by a GITHUB_TOKEN push wait for manual approval, so use
# DOMICILE_WRITEBACK_TOKEN when set. The empty value clears the checkout's
# header before this one is added.
if [ -n "${DOMICILE_WRITEBACK_TOKEN:-}" ]; then
  auth="$(printf 'x-access-token:%s' "$DOMICILE_WRITEBACK_TOKEN" | base64 | tr -d '\n')"
  git -c http.https://github.com/.extraheader= \
    -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $auth" \
    push -q origin "HEAD:refs/heads/$BRANCH"
else
  git push -q origin "HEAD:refs/heads/$BRANCH"
fi
echo "pushed $(git rev-parse --short HEAD) to $BRANCH"
