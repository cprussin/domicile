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
#
# DOMICILE_ENGINE_BUILD=official publishes the production build, under
# `engine-official-` rather than `engine-`: it is of the same series as the
# checked build engine.yml publishes, so a shared name would have each replace
# the other's engine under one tag.
set -euo pipefail

case "${DOMICILE_ENGINE_BUILD:-checked}" in
  (checked) PREFIX=engine ;;
  (official) PREFIX=engine-official ;;
  (*)
    echo "DOMICILE_ENGINE_BUILD is '$DOMICILE_ENGINE_BUILD'; the builds are 'checked' and 'official'." >&2
    exit 1
    ;;
esac

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

# THE API IS TRIED AGAIN ON A 5xx, A RATE LIMIT OR NO ANSWER AT ALL, and only
# then. Run #76 lost an 87-minute build to one 500 on creating the release, and
# engine job 110246634707 lost one to a connection timeout. Anything else
# (404, 422) is an answer, not a bad minute, and fails at once. Five tries,
# 15s doubling: 3m45s of waiting at most, then a loud failure naming the status.
API_ATTEMPTS=5

# Like `curl -f`: the body on stdout on a 2xx, exit 22 otherwise.
api() {
  local attempt=1 status url="" arg body
  for arg in "$@"; do
    case "$arg" in (http*) url="$arg" ;; esac
  done
  body="$(mktemp)"
  while :; do
    # `-w` prints 000 when curl reached nothing; curl says why on stderr.
    status="$(curl -sS -o "$body" -w '%{http_code}' \
                -H "Authorization: Bearer $GITHUB_TOKEN" \
                -H "Accept: application/vnd.github+json" \
                -H "X-GitHub-Api-Version: 2022-11-28" "$@")" || true
    case "$status" in
      (2??) cat "$body"; rm -f "$body"; return 0 ;;
    esac
    if api_retryable "$status" "$body" && [ "$attempt" -lt "$API_ATTEMPTS" ]; then
      echo "  GitHub answered $status to $url; attempt $((attempt + 1)) in $((15 << (attempt - 1)))s" >&2
      sleep $((15 << (attempt - 1)))
      attempt=$((attempt + 1))
    else
      echo "GitHub answered $status to $url (attempt $attempt of $API_ATTEMPTS): $(head -c 300 "$body")" >&2
      rm -f "$body"
      return 22
    fi
  done
}

# A 5xx, a 429, a 000 (curl reached nothing), or a 403 that says it is a
# (secondary) rate limit: GitHub answers a permission failure 403 too, and that
# one will not change.
api_retryable() { # status, body file
  case "$1" in
    (5??|429|000) return 0 ;;
    (403) grep -qi 'rate limit' "$2" ;;
    (*) return 1 ;;
  esac
}

# WHICH SERIES THIS BUILD IS OF. Stated in every release's body whichever kind
# it is, because `update-engine-release.sh` reads it back out of there and
# writes it into `engine-release.nix` -- which is what lets a checkout say
# whether the engine it pins was built from the series it carries without
# downloading anything.
IDENTITY="$(.github/scripts/engine-series-stamp.sh identity)"

if [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  TAG="$GITHUB_REF_NAME"
  PRERELEASE=false
  # A pushed tag is already immutable, so there is nothing for the second
  # release below to add: publishing a copy of it under another name would be
  # two names for one build with nothing to choose between them.
  PINNABLE=""
else
  TAG="$PREFIX-nightly"
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
  # NAMED AFTER THE SERIES, NOT AFTER THE COMMIT, and that is what stopped
  # most repins from having to happen at all.
  #
  # It was `engine-<short sha>`, so every release was a different release as
  # far as anything downstream could tell: a commit that touched
  # `packages/domicile-engine` at all -- a script, a BUILD arg, a line in a
  # patch header -- produced a new tag and a new hash, and therefore a second
  # pull request to move `engine-release.nix` onto it. Most of those repins
  # changed which bytes were fetched and nothing whatsoever about what was in
  # them.
  #
  # The series identity is the pin, `patches/` and `src/` hashed by content,
  # which is precisely what decides whether the shared Chromium checkout has
  # to be rebuilt. Two commits that do not move the fork are the same engine,
  # publish to the same tag, and need no repin between them.
  #
  # READ OUT OF `engine-series-stamp.sh` RATHER THAN COMPUTED HERE. That
  # script already answers this question for the checkout, and a second
  # implementation of "the same series" is a second thing that can drift. The
  # cheap direction of a drift is a repin that changes nothing; the expensive
  # one is no repin for a change that needed one, which is #411's failure
  # with a new cause.
  #
  # The same twelve characters the tarball is named after, so the tag and the
  # filename cannot drift apart.
  PINNABLE="$PREFIX-s${IDENTITY:0:12}"
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
  if [ "$TAG" = "$PREFIX-nightly" ]; then
    api -X DELETE "$API/git/refs/tags/$TAG" >/dev/null 2>&1 || true
  fi
fi

PIN="$(grep -v '^#' packages/domicile-engine/CHROMIUM_PIN | tr -d '[:space:]')"
BODY=$(cat <<BODY
A patched Chromium, built on crux, that \`domicile-compositor\` can use as its
engine without anybody building one.

- series identity: \`$IDENTITY\`
- domicile commit: \`$GITHUB_SHA\`
- chromium pin: \`$PIN\`
- build: \`${DOMICILE_ENGINE_BUILD:-checked}\`
- gn args: \`.github/scripts/engine-release-build.sh\` at that commit${PINNABLE:+
- immutable release: \`$PINNABLE\`}

Unpack it and put the directory on \`LD_LIBRARY_PATH\`:
\`libdomicile_engine.so\` is dlopened by name.

This artifact was asserted before publication by the same pixel guard the
engine workflow runs: a real Wayland client's window drawn on a page, and a
negative control that fails when nothing draws.
BODY
)

# A release for this tag, made here or found. A create GitHub answered 500 may
# still have landed, and its retry is then 422 `already_exists`: the release
# that exists is this run's, and the uploads below clear any asset on it first.
create_release() { # tag, prerelease
  api -X POST "$API/releases" -d "$(
    jq -n --arg tag "$1" --arg sha "$GITHUB_SHA" --arg body "$BODY" \
          --argjson pre "$2" \
      '{tag_name: $tag, target_commitish: $sha, name: $tag, body: $body, prerelease: $pre}'
  )" || {
    echo "  the create failed; filling $1 if GitHub made it anyway" >&2
    api "$API/releases/tags/$1"
  }
}

echo "creating release $TAG"
release=$(create_release "$TAG" "$PRERELEASE")
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
    pinnable=$(create_release "$PINNABLE" false)
    upload_assets "$(echo "$pinnable" | jq -r .id)"
    echo "published $(echo "$pinnable" | jq -r .html_url)"
  fi
fi
