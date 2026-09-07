#!/usr/bin/env bash
# Put the tarball on a GitHub release.
#
#   GITHUB_TOKEN=... .github/scripts/engine-release-publish.sh /build/engine-release name.tar.zst
#
# curl and jq rather than an action, because the runner has both and neither is
# a third party with a token. See config/machines/crux/domicile-ci.nix in
# cprussin/dotfiles for what is on this unit's PATH.
#
# TWO KINDS OF RELEASE, one code path. A tag push publishes that tag. A manual
# run republishes `engine-nightly`, which is deleted and recreated so that the
# name always means the newest build rather than the first one anybody made —
# the assets carry the commit in their filename, so nothing is ambiguous about
# which build a downloaded file is.
set -euo pipefail

STAGE="${1:-}"
TARBALL="${2:-}"
: "${GITHUB_TOKEN:?a token with contents: write is required}"
: "${GITHUB_REPOSITORY:?}"

if [ -z "$STAGE" ] || [ -z "$TARBALL" ]; then
  echo "usage: engine-release-publish.sh <stage dir> <tarball name>" >&2
  exit 1
fi
[ -f "$STAGE/$TARBALL" ] || { echo "no $STAGE/$TARBALL to publish" >&2; exit 1; }

API="https://api.github.com/repos/$GITHUB_REPOSITORY"
UPLOADS="https://uploads.github.com/repos/$GITHUB_REPOSITORY"
api() { curl -sS -f -H "Authorization: Bearer $GITHUB_TOKEN" \
             -H "Accept: application/vnd.github+json" \
             -H "X-GitHub-Api-Version: 2022-11-28" "$@"; }

if [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  TAG="$GITHUB_REF_NAME"
  PRERELEASE=false
else
  TAG="engine-nightly"
  PRERELEASE=true
fi

# A release for this tag may exist: the nightly always does after the first
# run, and a tag can be re-pushed. Delete it and its tag so that create below
# is the only path that makes one — updating in place would leave the previous
# run's assets beside this run's, under names that differ only by a commit
# nobody is comparing.
if existing=$(api "$API/releases/tags/$TAG" 2>/dev/null); then
  id=$(echo "$existing" | jq -r .id)
  echo "replacing release $TAG ($id)"
  api -X DELETE "$API/releases/$id" >/dev/null
  # Only the nightly's tag is ours to move. A pushed tag is a fact about the
  # history and deleting it would rewrite what somebody else is pointing at.
  if [ "$TAG" = "engine-nightly" ]; then
    api -X DELETE "$API/git/refs/tags/$TAG" >/dev/null 2>&1 || true
  fi
fi

PIN="$(grep -v '^#' packages/domicile-engine/CHROMIUM_PIN | tr -d '[:space:]')"
BODY=$(cat <<BODY
A patched Chromium, built on crux, that \`domicile-compositor\` can use as its
engine without anybody building one.

- domicile commit: \`$GITHUB_SHA\`
- chromium pin: \`$PIN\`
- gn args: \`.github/scripts/engine-release-build.sh\` at that commit

Unpack it and put the directory on \`LD_LIBRARY_PATH\`:
\`libdomicile_engine.so\` is dlopened by name.

This artifact was asserted before publication by the same pixel guard the
engine workflow runs: a real Wayland client's window drawn on a page, and a
negative control that fails when nothing draws.
BODY
)

echo "creating release $TAG"
release=$(jq -n --arg tag "$TAG" --arg sha "$GITHUB_SHA" --arg body "$BODY" \
                --argjson pre "$PRERELEASE" \
  '{tag_name: $tag, target_commitish: $sha, name: $tag, body: $body, prerelease: $pre}' |
  api -X POST "$API/releases" -d @-)
id=$(echo "$release" | jq -r .id)

for asset in "$TARBALL" "$TARBALL.sha256"; do
  echo "uploading $asset"
  curl -sS -f -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    --data-binary "@$STAGE/$asset" \
    "$UPLOADS/releases/$id/assets?name=$asset" >/dev/null
done

echo "published $(echo "$release" | jq -r .html_url)"
