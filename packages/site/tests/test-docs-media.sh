#!/usr/bin/env bash
# Asserts the docs media scripts refuse what they must not do, before they
# start a compositor or push.
#
# - `docs-media.sh` names a scene that does not exist, rather than capturing
#   nothing.
# - The write-back never pushes to a branch the repository releases from.
# - A recording's captions show from just before their key until the next one,
#   for at most a couple of seconds.
# - The upload puts each new file on R2 under its hash, once, and never
#   replaces one.
#
# The captures themselves need a render node and run on `crux`
# (`docs-media.yml`).
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CAPTURE="$ROOT/packages/site/scripts/docs-media.sh"
WRITEBACK="$ROOT/.github/scripts/docs-media-writeback.sh"
UPLOAD="$ROOT/.github/scripts/docs-media-upload.sh"
# shellcheck source=packages/site/scripts/docs-media/captions.sh
. "$ROOT/packages/site/scripts/docs-media/captions.sh"

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

said="$("$CAPTURE" no-such-scene 2>&1)"
status=$?
if [ "$status" -ne 0 ] && printf '%s' "$said" | grep -q "no scene no-such-scene"; then
  ok "docs-media.sh names a missing scene"
else
  fail "docs-media.sh names a missing scene" "exit $status: $said"
fi

for branch in main stable release; do
  said="$("$WRITEBACK" "$branch" 2>&1)"
  status=$?
  if [ "$status" -ne 0 ] && printf '%s' "$said" | grep -q "$branch is protected"; then
    ok "the write-back refuses $branch"
  else
    fail "the write-back refuses $branch" "exit $status: $said"
  fi
done

dir="$(mktemp -d)"
printf '1.00\tMeta+Space opens the launcher\n5.00\tMeta+E puts them side by side\n5.80\tMeta+Shift+Tab floats one\n' \
  >"$dir/scene.captions"
filter="$(caption_filter "$dir/scene.captions" /font.ttf "$dir")"
if printf '%s' "$filter" | grep -q "between(t,0.70,2.90)" &&
   printf '%s' "$filter" | grep -q "between(t,4.70,5.35)" &&
   printf '%s' "$filter" | grep -q "between(t,5.50,7.70)" &&
   [ "$(cat "$dir/caption-1.txt")" = "Meta+Space opens the launcher" ]; then
  ok "captions show until the next one, at most a couple of seconds"
else
  fail "captions show until the next one, at most a couple of seconds" "$filter"
fi
rm -rf "$dir"

# A stand-in `aws` that records each call and has only `5891b5b522d5df08/a.png`.
dir="$(mktemp -d)"
mkdir -p "$dir/bin" "$dir/media"
cat >"$dir/bin/aws" <<'STAND_IN'
#!/usr/bin/env bash
echo "aws $* id=$AWS_ACCESS_KEY_ID region=$AWS_DEFAULT_REGION" >>"$LOG"
case "$*" in
  *"head-object"*"--key 5891b5b522d5df08/a.png"*) exit 0 ;;
  *"head-object"*) exit 254 ;;
esac
STAND_IN
chmod +x "$dir/bin/aws"
printf 'hello\n' >"$dir/media/a.png"
printf 'video\n' >"$dir/media/b.mp4"
printf 'video\n' >"$dir/media/b.webm"
printf 'docs\n' >"$dir/media/README.md"
upload() { # environment...
  : >"$dir/log"
  env PATH="$dir/bin:$PATH" LOG="$dir/log" R2_ACCOUNT_ID=acct \
    R2_ACCESS_KEY_ID=id R2_SECRET_ACCESS_KEY=secret DOCS_MEDIA_R2_BUCKET=media \
    "$@" "$UPLOAD" "$dir/media" 2>&1
}
endpoint="--endpoint-url https://acct.r2.cloudflarestorage.com"
cache="--cache-control public, max-age=31536000, immutable"
mp4="$(printf 'video\n' | sha256sum | cut -c1-16)/b.mp4"
webm="$(printf 'video\n' | sha256sum | cut -c1-16)/b.webm"
if said="$(upload)"; then
  want="aws s3api head-object --bucket media --key 5891b5b522d5df08/a.png $endpoint id=id region=auto
aws s3api head-object --bucket media --key $mp4 $endpoint id=id region=auto
aws s3 cp $dir/media/b.mp4 s3://media/$mp4 $endpoint --only-show-errors --content-type video/mp4 $cache id=id region=auto
aws s3api head-object --bucket media --key $webm $endpoint id=id region=auto
aws s3 cp $dir/media/b.webm s3://media/$webm $endpoint --only-show-errors --content-type video/webm $cache id=id region=auto"
  if [ "$(cat "$dir/log")" = "$want" ]; then
    ok "the upload adds only what R2 lacks, under its hash"
  else
    fail "the upload adds only what R2 lacks, under its hash" "$(cat "$dir/log")"
  fi
else
  fail "the upload adds only what R2 lacks, under its hash" "$said"
fi
if said="$(upload DOCS_MEDIA_R2_BUCKET= R2_ACCOUNT_ID=)" &&
   grep -q -- "--bucket domicile-docs-media .*https://9e3478be0713138076f5a66696ba7817.r2" "$dir/log"; then
  ok "the upload defaults to Domicile's account and bucket"
else
  fail "the upload defaults to Domicile's account and bucket" "$said $(cat "$dir/log")"
fi
if said="$(upload R2_SECRET_ACCESS_KEY=)"; then
  fail "the upload needs the R2 credentials" "it succeeded"
elif [ -s "$dir/log" ]; then
  fail "the upload needs the R2 credentials" "$(cat "$dir/log")"
else
  ok "the upload needs the R2 credentials"
fi
rm -rf "$dir"

[ "$FAILED" -eq 0 ] || exit 1
echo "all ok"
