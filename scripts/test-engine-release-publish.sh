#!/usr/bin/env bash
# Whether a published engine stays fetchable after the next one is published.
#
# `engine-nightly` is DELETED AND RECREATED on every release run, so the asset
# a checkout is pinned to stops existing the moment anybody cuts a new build:
# `nix run` on main answers `cannot download ... from any mirror` and every
# open pull request goes red on `packages` for a reason none of them caused.
# That happened twice in one afternoon. The fix is a second release per build,
# tagged with the commit and never deleted, and this is what says it is still
# there.
#
# Against a fake GitHub, because the real one cannot be asked "and what would
# you have done" — and a test that publishes to check publishing has published.
# The fake records every request and answers as the API does, which is enough:
# what is under test is which releases the script creates, which it leaves
# alone, and where the assets go.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH="$ROOT/.github/scripts/engine-release-publish.sh"
[ -f "$PUBLISH" ] || { echo "no $PUBLISH" >&2; exit 1; }

# `SKIP:` on stdout and nothing else: that prefix is what `check.sh` reads the
# reason out of (`sed -n 's/^ *SKIP: *//p'`), and a reason printed any other way
# is one the runner never shows -- under `DOMICILE_CHECK_STRICT=1` it becomes a
# `FAILED ()` with nothing in the parentheses.
command -v jq >/dev/null 2>&1 || {
  echo "SKIP: no jq, which both the publisher and the fake GitHub here parse with"
  exit 77
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BIN="$WORK/bin"
mkdir -p "$BIN"

# The stage the packaging step leaves behind: a tarball and the digest beside
# it. Contents are never read by the publisher, only uploaded.
STAGE="$WORK/stage"
TARBALL="domicile-engine-deadbee-linux-x64.tar.zst"
mkdir -p "$STAGE"
echo "not really a tarball" > "$STAGE/$TARBALL"
echo "not really a digest" > "$STAGE/$TARBALL.sha256"

cat > "$BIN/curl" <<'FAKE'
#!/usr/bin/env bash
# GitHub, as far as the publisher can tell. Every call is appended to
# `$STATE/calls` as `<METHOD> <url>`; a release exists iff `$STATE/rel-<tag>`
# does, and `-f` is honored by exiting 22 when it does not.
set -u
state="$FAKE_STATE"
method=GET; url=""; stdin_body=0; upload=""
prev=""
for arg in "$@"; do
  [ "$prev" = "-X" ] && method="$arg"
  case "$arg" in
    http*) url="$arg" ;;
    @-) stdin_body=1 ;;
    @*) upload="${arg#@}" ;;
  esac
  prev="$arg"
done
echo "$method $url" >> "$state/calls"

if [ -n "$upload" ]; then
  # `.../releases/<id>/assets?name=<file>`
  id="${url#*/releases/}"; id="${id%%/assets*}"
  name="${url##*name=}"
  # An upload GitHub drops is not a no-op. It records the asset, leaves it in
  # `starter` rather than `uploaded`, and answers 500 anyway -- so the next
  # POST for that name comes back 422 `already_exists` and a plain retry is not
  # enough. `$STATE/fail-uploads` is how many of the next uploads do that.
  left="$(cat "$state/fail-uploads" 2>/dev/null || echo 0)"
  if [ "$left" -gt 0 ]; then
    echo "$((left - 1))" > "$state/fail-uploads"
    echo "$id $name starter" >> "$state/assets"
    exit 22
  fi
  echo "$id $name uploaded" >> "$state/assets"
  exit 0
fi

case "$method" in
  GET)
    case "$url" in
      # The assets already on a release, with an id the DELETE below can take
      # the release and the name back out of.
      (*/assets)
        id="${url#*/releases/}"; id="${id%%/assets}"
        awk -v id="$id" '$1 == id { print $2, $3 }' "$state/assets" |
          jq -R -s -c --arg id "$id" \
            'split("\n") | map(select(length > 0)) | map(split(" ")) |
             map({id: ($id + "!" + .[0]), name: .[0], state: .[1]})'
        ;;
      (*)
        tag="${url##*/}"
        [ -f "$state/rel-$tag" ] || exit 22
        cat "$state/rel-$tag"
        ;;
    esac
    ;;
  POST)
    body=""; [ "$stdin_body" = 1 ] && body="$(cat)"
    tag="$(printf '%s' "$body" | jq -r .tag_name)"
    printf '%s' "$body" > "$state/created-$tag.json"
    jq -n --arg tag "$tag" \
      '{id: ("id-" + $tag), html_url: ("https://example.invalid/" + $tag)}' \
      > "$state/rel-$tag"
    cat "$state/rel-$tag"
    ;;
  DELETE)
    case "$url" in
      (*/releases/assets/*)
        asset="${url##*/releases/assets/}"
        echo "${asset#*!}" >> "$state/deleted-assets"
        awk -v rel="${asset%%!*}" -v name="${asset#*!}" \
          '!($1 == rel && $2 == name)' "$state/assets" > "$state/left"
        mv "$state/left" "$state/assets"
        ;;
      # By id, which the fake made from the tag, so the tag is recoverable.
      (*)
        id="${url##*/}"
        echo "${id#id-}" >> "$state/deleted"
        rm -f "$state/rel-${id#id-}"
        # A deleted release takes its assets with it.
        awk -v rel="$id" '$1 != rel' "$state/assets" > "$state/left"
        mv "$state/left" "$state/assets"
        ;;
    esac
    ;;
esac
FAKE
chmod +x "$BIN/curl"

# The publisher backs off between attempts, and this suite has no time it is
# willing to spend waiting for a fake GitHub to come back.
cat > "$BIN/sleep" <<'NAP'
#!/usr/bin/env bash
exit 0
NAP
chmod +x "$BIN/sleep"

# WHAT THE IMMUTABLE TAG IS NAMED AFTER, and it is no longer the commit.
#
# It was `engine-<short sha>`, which made every published engine a different
# engine as far as anything downstream could tell — so a commit that touched
# `packages/domicile-engine` at all, a script, a BUILD arg, a comment in a
# patch header, produced a new tag, a new hash and therefore a second pull
# request to repin `engine-release.nix`. Most of those repins changed which
# bytes were fetched and nothing about what they contained.
#
# The tag is the SERIES IDENTITY now — the pin, `patches/` and `src/`, hashed
# by content, which is exactly what `engine-series-stamp.sh` already computes
# to decide whether the shared checkout needs rebuilding. Two commits that do
# not move the fork are the same engine, so they publish to the same tag and
# need no repin between them.
#
# Read out of that script rather than computed here, for the reason that script
# gives: a second implementation of "the same series" is a second thing that
# can drift, and the expensive direction of the drift is no repin for a change
# that needed one.
IDENTITY="$(cd "$ROOT" && .github/scripts/engine-series-stamp.sh identity)"
PINNABLE="engine-s${IDENTITY:0:12}"

FAILED=0
fail() { echo "  FAIL: $*" >&2; FAILED=1; }

# One run of the publisher against a fresh fake. `$1` is the state directory to
# use, which a caller can pre-seed with releases that already exist.
publish() {
  local state="$1"; shift
  mkdir -p "$state"
  # Created rather than truncated: a caller pre-seeds these to say what GitHub
  # already holds, and a run that wiped that would be answering its own
  # question.
  for ledger in calls assets deleted deleted-assets; do
    [ -f "$state/$ledger" ] || : > "$state/$ledger"
  done
  # `env`, not a bare prefix: an assignment that arrives by expansion is a
  # command name, not an assignment, so `"$@"` in front of `bash` ran
  # `GITHUB_REF_TYPE=tag: command not found` and the tag case tested nothing.
  ( cd "$ROOT" && env PATH="$BIN:$PATH" FAKE_STATE="$state" \
      GITHUB_TOKEN=fake GITHUB_REPOSITORY=cprussin/domicile \
      GITHUB_SHA=0123456789abcdef0123456789abcdef01234567 \
      "$@" bash "$PUBLISH" "$STAGE" "$TARBALL" ) > "$state/out" 2>&1
}

echo "a nightly publishes a release that is never replaced"
state="$WORK/nightly"
publish "$state" || { cat "$state/out" >&2; fail "publisher exited nonzero"; }

[ -f "$state/created-engine-nightly.json" ] ||
  fail "no engine-nightly was created"
[ -f "$state/created-$PINNABLE.json" ] ||
  fail "no $PINNABLE was created; a pin would point at the rolling tag"

# Both assets on BOTH releases. Uploading only to the nightly would make the
# immutable release a tag with nothing behind it, which 404s exactly as before.
for release in engine-nightly "$PINNABLE"; do
  count="$(grep -c "^id-$release " "$state/assets" || true)"
  [ "$count" = "2" ] ||
    fail "$release got $count assets, wanted the tarball and its digest"
done

# So that nothing downstream has to guess the tag from the commit: the rolling
# release says which immutable one holds the same build.
body="$(jq -r .body "$state/created-engine-nightly.json")"
case "$body" in
  (*"immutable release: \`$PINNABLE\`"*) ;;
  (*) fail "engine-nightly's body does not name $PINNABLE" ;;
esac

# AND WHICH SERIES IT IS, in full rather than truncated to the twelve
# characters the tag carries. `update-engine-release.sh` writes that value into
# `engine-release.nix`, and the check that says "this checkout describes an
# engine nobody has built" compares it against the series in hand — a
# comparison of prefixes would answer a weaker question than the one asked.
case "$body" in
  (*"series identity: \`$IDENTITY\`"*) ;;
  (*) fail "engine-nightly's body does not state the series identity" ;;
esac

echo "publishing again leaves an already published commit alone"
# The whole point of the second release: something may already be pinned to it.
# A second run for the same commit -- a re-dispatch, a retry -- must not delete
# and recreate it, because that is the rolling tag's bug with a longer name.
again="$WORK/again"
mkdir -p "$again"
cp "$state/rel-engine-nightly" "$state/rel-$PINNABLE" "$again/" 2>/dev/null
printf '%s\n%s\n' "id-$PINNABLE $TARBALL uploaded" \
                   "id-$PINNABLE $TARBALL.sha256 uploaded" > "$again/assets"
publish "$again" || { cat "$again/out" >&2; fail "publisher exited nonzero"; }
grep -qx "$PINNABLE" "$again/deleted" &&
  fail "$PINNABLE was deleted; a pin to it would have broken"
[ -f "$again/created-$PINNABLE.json" ] &&
  fail "$PINNABLE was recreated rather than left alone"
grep -q "^id-$PINNABLE " "$again/deleted-assets" 2>/dev/null &&
  fail "an asset was taken off $PINNABLE; a pin to it would have broken"
grep -qx "engine-nightly" "$again/deleted" ||
  fail "engine-nightly was not replaced; it must always mean the newest build"

echo "a release whose upload died is finished, not skipped"
# Run 35260586435 put both assets on engine-nightly in seven seconds, created
# the immutable release beside it, and then hung with nothing on it. `already
# published; leaving it alone` would have meant that tag NEVER got its tarball:
# a release is published when its assets are there, not when its row exists.
half="$WORK/half"
mkdir -p "$half"
cp "$state/rel-engine-nightly" "$state/rel-$PINNABLE" "$half/" 2>/dev/null
# The digest landed; the tarball is the wreck of an upload that did not.
printf '%s\n%s\n' "id-$PINNABLE $TARBALL starter" \
                   "id-$PINNABLE $TARBALL.sha256 uploaded" > "$half/assets"
publish "$half" || { cat "$half/out" >&2; fail "publisher exited nonzero"; }

[ -f "$half/created-$PINNABLE.json" ] &&
  fail "$PINNABLE was recreated rather than finished"
grep -q "^id-$PINNABLE $TARBALL uploaded$" "$half/assets" ||
  fail "$PINNABLE never got its tarball"
grep -qx "$TARBALL" "$half/deleted-assets" ||
  fail "the half-uploaded tarball was counted as present and left in place"
grep -qx "$TARBALL.sha256" "$half/deleted-assets" &&
  fail "the digest was already there and should not have been touched"

echo "a pushed tag is published once, under the name that was pushed"
# An `engine-v*` tag is already immutable. A second copy under another name
# would be two names for one build with nothing to choose between them.
tagged="$WORK/tagged"
publish "$tagged" GITHUB_REF_TYPE=tag GITHUB_REF_NAME=engine-v1.2.3 ||
  { cat "$tagged/out" >&2; fail "publisher exited nonzero"; }
[ -f "$tagged/created-engine-v1.2.3.json" ] ||
  fail "the pushed tag was not published"
[ -f "$tagged/created-$PINNABLE.json" ] &&
  fail "a pushed tag was copied to $PINNABLE"
case "$(jq -r .body "$tagged/created-engine-v1.2.3.json")" in
  (*"immutable release"*) fail "a pushed tag points at an immutable release that is itself" ;;
esac
# And its own tag is a fact about the history: deleting it would rewrite what
# somebody else is pointing at.
grep -q . "$tagged/deleted" 2>/dev/null &&
  fail "a pushed tag's release was deleted: $(cat "$tagged/deleted")"

echo "an upload GitHub drops is tried again"
# Run 35252793831 built the engine, packaged it and passed the pixel guard, and
# then lost all 27 minutes of it to `curl: (22) The requested URL returned
# error: 500` 28 seconds into the tarball. A rebuild of Chromium to re-attempt
# an upload is the most expensive no-op this repository has.
dropped="$WORK/dropped"
mkdir -p "$dropped"
echo 1 > "$dropped/fail-uploads"
publish "$dropped" || { cat "$dropped/out" >&2; fail "publisher exited nonzero"; }

for release in engine-nightly "$PINNABLE"; do
  count="$(grep -c "^id-$release " "$dropped/assets" || true)"
  [ "$count" = "2" ] ||
    fail "$release got $count assets after a dropped upload, wanted 2"
done

# And the remains of the dropped attempt are cleared first: GitHub keeps the
# asset it never finished, and every later POST for that name is 422
# `already_exists`, so a retry that does not clear it retries forever.
grep -qx "$TARBALL" "$dropped/deleted-assets" ||
  fail "the dropped upload's asset was left on the release"

[ "$FAILED" = "0" ] || exit 1
echo "engine-release-publish: a published engine stays fetchable"
