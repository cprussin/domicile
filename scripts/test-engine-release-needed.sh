#!/usr/bin/env bash
# What the engine job has left to do about a release, decided once.
#
# An engine change is ONE pull request now, and this is the step that decides
# what that pull request still owes. Three states, and the cost between them
# is four hours:
#
#   - `engine-release.nix` already names this series. Nothing to do; this is
#     every pull request that does not move the fork, which is most of them.
#   - It does not, but a release for this series is already published — a
#     re-run, a force-push that did not change the series, a branch that
#     rebased onto one that had already built it. Regenerate the file and push
#     it. No build.
#   - Nothing is published. Build the release configuration, publish it,
#     regenerate, push.
#
# THE EXPENSIVE MISTAKE IS SAYING "BUILD" WHEN NOTHING NEEDED BUILDING, and
# the one after it is saying "nothing to do" when the fork moved — that is a
# repository that describes one engine and ships another, which is #411. So
# both directions get cases below.
#
# The API half is faked. What is under test is the decision, not GitHub.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEEDED="$ROOT/.github/scripts/engine-release-needed.sh"
[ -x "$NEEDED" ] || { echo "no $NEEDED" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || {
  echo "SKIP: no jq, which this script reads the API with"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

BIN="$WORK/bin"
mkdir -p "$BIN"
# GitHub, as far as this script can tell: a release exists iff `$FAKE_STATE`
# names it. `-f` is honored by exiting 22, which is what the real curl does and
# what the script reads "no such release" out of.
cat > "$BIN/curl" <<'FAKE'
#!/usr/bin/env bash
url="${!#}"
tag="${url##*/}"
if [ "$tag" = "$(cat "$FAKE_STATE" 2>/dev/null)" ]; then
  printf '{"tag_name":"%s"}\n' "$tag"
  exit 0
fi
exit 22
FAKE
chmod +x "$BIN/curl"

IDENTITY="$(cd "$ROOT" && .github/scripts/engine-series-stamp.sh identity)"
TAG="engine-s${IDENTITY:0:12}"

# The repository's own `engine-release.nix`, put back after each case: these
# run against the real checkout, because what "this series" means is the whole
# question and a fake tree would be answering a different one.
RELEASE="$ROOT/packages/domicile-engine/engine-release.nix"
cp "$RELEASE" "$WORK/engine-release.nix.orig"
restore() { cp "$WORK/engine-release.nix.orig" "$RELEASE"; }
trap 'restore; rm -rf "$WORK"' EXIT

pins() { # identity to write into the generated file
  sed -i "s/^  identity = \".*\";/  identity = \"$1\";/" "$RELEASE"
}

needed() { # published tag the fake API holds, or empty for none
  local out
  out="$WORK/gh-output"
  : >"$out"
  printf '%s' "$1" >"$WORK/published"
  ( cd "$ROOT" && env PATH="$BIN:$PATH" FAKE_STATE="$WORK/published" \
      GITHUB_OUTPUT="$out" GITHUB_TOKEN=fake \
      GITHUB_REPOSITORY=cprussin/domicile \
      "$NEEDED" ) >"$WORK/said" 2>&1
  cat "$out"
}
key() { sed -n "s/^$2=//p" <<<"$1" | head -1; }

echo "== the fork did not move =="

restore
pins "$IDENTITY"
out="$(needed "$TAG")"
expect "nothing to build" false "$(key "$out" build)"
expect "and nothing to write" false "$(key "$out" write)"

# THE CASE THAT MUST NOT COST FOUR HOURS. The file already names this series,
# so whether a release is *also* findable is not a question worth an API call
# — and answering it wrong in the other direction would rebuild Chromium for a
# pull request that changed a comment.
out="$(needed "")"
expect "even when the API cannot find the release, there is nothing to do" \
  false "$(key "$out" build)"

echo
echo "== the fork moved and nothing is published =="

restore
pins "0000000000000000000000000000000000000000000000000000000000000000"
out="$(needed "")"
expect "the release has to be built" true "$(key "$out" build)"
expect "and written back" true "$(key "$out" write)"
expect "under the tag this series names" "$TAG" "$(key "$out" tag)"
expect "and the identity is stated in full" "$IDENTITY" "$(key "$out" identity)"

echo
echo "== the fork moved and this series is already published =="

# A re-run, a force-push that left the series alone, or a branch rebased onto
# one that had already built it. The tarball exists and is the right one —
# rebuilding it would be four hours to produce a DIFFERENT tarball, since
# Chromium does not build byte-for-byte twice, and the hash already published
# is the one anything pinned to it is using.
restore
pins "0000000000000000000000000000000000000000000000000000000000000000"
out="$(needed "$TAG")"
expect "there is nothing to build" false "$(key "$out" build)"
expect "but the file still has to be written back" true "$(key "$out" write)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "engine-release-needed: all cases passed"
else
  echo "engine-release-needed: $FAILED case(s) failed"
fi
exit "$FAILED"
