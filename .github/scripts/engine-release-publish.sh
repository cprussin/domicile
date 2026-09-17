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
  # A pushed tag is already immutable, so there is nothing for the second
  # release below to add: publishing a copy of it under another name would be
  # two names for one build with nothing to choose between them.
  PINNABLE=""
else
  TAG="engine-nightly"
  PRERELEASE=true
  # THE ROLLING TAG CANNOT BE PINNED, and that is what the second release is
  # for. `engine-nightly` is deleted and recreated on every run, so the asset
  # a checkout is pinned to STOPS EXISTING the moment anybody cuts a release:
  # `nix run` on main starts 404ing and every open pull request goes red on
  # `packages` with `cannot download ... from any mirror`. That happened twice
  # in one afternoon, which is once more than a papercut, and it made
  # engine-release.nix's own header -- "a flake revision names exactly one
  # engine" -- false.
  #
  # The same short revision the tarball is named after, so the tag and the
  # filename cannot drift apart.
  PINNABLE="engine-$(git rev-parse --short HEAD)"
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
- gn args: \`.github/scripts/engine-release-build.sh\` at that commit${PINNABLE:+
- immutable release: \`$PINNABLE\`}

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

# What a release carries: the build, and the digest beside it.
ASSETS=("$TARBALL" "$TARBALL.sha256")

# How many times one asset is offered before the run gives up. GITHUB'S UPLOAD
# ENDPOINT 500s, and half a gigabyte is a long time to be exposed to it: run
# 35252793831 built the engine, packaged it and passed the pixel guard, and then
# lost all 27 minutes of it to `curl: (22) The requested URL returned error:
# 500` 28 seconds into the tarball. Rebuilding Chromium to re-attempt an upload
# is the most expensive no-op this repository has.
UPLOAD_ATTEMPTS=4

# NOT `curl --retry`: an upload that reached GitHub before it failed leaves the
# asset on the release, and every later POST for that name answers 422
# `already_exists` — so the retry that matters is the one that clears the name
# first, which is what this does on every attempt.
upload_asset() {
  local into="$1" asset="$2" attempt=1
  while :; do
    api "$API/releases/$into/assets" |
      jq -r --arg name "$asset" '.[] | select(.name == $name) | .id' |
      while read -r stale; do
        echo "  dropping what a failed upload left behind ($stale)"
        api -X DELETE "$API/releases/assets/$stale" >/dev/null
      done
    # AN UPLOAD WITH NO CEILING IS NOT A RETRY, IT IS A HANG. Run
    # 35260586435 put both assets on the nightly in seven seconds, then sat on
    # the next one for a quarter of an hour with nothing to end it, because
    # curl waits on a stalled socket for as long as the kernel lets it. Ten
    # minutes is an order of magnitude more than any upload here has honestly
    # taken, and a flat ceiling rather than `--speed-time` because curl stops
    # counting bytes while GitHub digests 200MB and answers -- which is
    # exactly the silence a rate floor would kill a good upload during.
    if curl -sS -f -X POST \
         --connect-timeout 30 --max-time 600 \
         -H "Authorization: Bearer $GITHUB_TOKEN" \
         -H "Content-Type: application/octet-stream" \
         --data-binary "@$STAGE/$asset" \
         "$UPLOADS/releases/$into/assets?name=$asset" >/dev/null; then
      return 0
    fi
    [ "$attempt" -lt "$UPLOAD_ATTEMPTS" ] || {
      echo "$asset did not upload in $attempt attempts" >&2
      return 1
    }
    echo "  that upload did not land; attempt $((attempt + 1)) in $((attempt * 15))s"
    sleep $((attempt * 15))
    attempt=$((attempt + 1))
  done
}

upload_assets() {
  local into="$1"
  for asset in "${ASSETS[@]}"; do
    echo "uploading $asset"
    upload_asset "$into" "$asset"
  done
}

# Put on a release only what is not already on it. A RELEASE IS PUBLISHED WHEN
# ITS ASSETS ARE THERE, NOT WHEN ITS ROW EXISTS: run 35260586435 put both
# assets on `engine-nightly` in seven seconds, created the immutable release
# beside it, and then hung with nothing on it, and `already published; leaving
# it alone` would have meant that tag never got its tarball however many times
# anybody re-ran the workflow.
#
# `uploaded` and not merely present, because the wreck an interrupted upload
# leaves behind is an asset row in `starter` that nothing can download.
# Anything already `uploaded` is left exactly as it is: something may be
# pinned to it, and that is the whole reason this release exists.
complete_assets() {
  local into="$1" landed
  landed="$(api "$API/releases/$into/assets" |
              jq -r '.[] | select(.state == "uploaded") | .name')"
  for asset in "${ASSETS[@]}"; do
    if printf '%s\n' "$landed" | grep -qxF "$asset"; then
      echo "$asset is already there; left alone"
    else
      echo "uploading $asset"
      upload_asset "$into" "$asset"
    fi
  done
}

upload_assets "$id"
echo "published $(echo "$release" | jq -r .html_url)"

# The release that keeps existing. Every build is ALSO published under a tag
# naming its commit, and that release is never deleted, so a pin points at a
# url that does not move. The nightly stays because it is the useful thing to
# hand somebody who just wants the newest build.
if [ -n "$PINNABLE" ]; then
  if pinned=$(api "$API/releases/tags/$PINNABLE" 2>/dev/null); then
    # Re-running a release for a commit that already has one. Never deleted and
    # recreated -- something may already be pinned to it, and the whole point of
    # this release is that what it points at does not move -- but a run that
    # died between creating it and filling it leaves a tag with nothing behind
    # it, and only another run can finish that.
    echo "$PINNABLE already exists; adding whatever is missing from it"
    complete_assets "$(echo "$pinned" | jq -r .id)"
  else
    echo "creating release $PINNABLE"
    pinnable=$(jq -n --arg tag "$PINNABLE" --arg sha "$GITHUB_SHA" \
                    --arg body "$BODY" \
      '{tag_name: $tag, target_commitish: $sha, name: $tag, body: $body, prerelease: false}' |
      api -X POST "$API/releases" -d @-)
    upload_assets "$(echo "$pinnable" | jq -r .id)"
    echo "published $(echo "$pinnable" | jq -r .html_url)"
  fi
fi
