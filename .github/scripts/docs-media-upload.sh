#!/usr/bin/env bash
# Puts the docs media on R2, where the site serves it from
# https://media.domicile-desktop.com.
#
#   .github/scripts/docs-media-upload.sh [dir]   # default: docs/media
#
# Each file goes under `<hash>/<name>`, the first 16 hex digits of its SHA-256
# (`packages/site/src/media/mediaUrl.ts` builds the same URL). A key never
# changes what it holds, so the upload skips keys R2 has, never deletes, and
# every deployed site keeps working.
#
# Reads `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. `R2_ACCOUNT_ID` and
# `DOCS_MEDIA_R2_BUCKET` override Domicile's Cloudflare account and the
# `domicile-docs-media` bucket.
set -euo pipefail

MEDIA="${1:-$(cd "$(dirname "$0")/../.." && pwd)/docs/media}"

: "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-9e3478be0713138076f5a66696ba7817}"
DOCS_MEDIA_R2_BUCKET="${DOCS_MEDIA_R2_BUCKET:-domicile-docs-media}"
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

shopt -s nullglob
for file in "$MEDIA"/*.png "$MEDIA"/*.mp4 "$MEDIA"/*.webm; do
  name="$(basename "$file")"
  key="$(sha256sum "$file" | cut -c1-16)/$name"
  if aws s3api head-object --bucket "$DOCS_MEDIA_R2_BUCKET" --key "$key" \
    --endpoint-url "$ENDPOINT" >/dev/null 2>&1; then
    continue
  fi
  case "$name" in
    *.png) type=image/png ;;
    *.mp4) type=video/mp4 ;;
    *.webm) type=video/webm ;;
  esac
  echo "uploading $key"
  aws s3 cp "$file" "s3://$DOCS_MEDIA_R2_BUCKET/$key" --endpoint-url "$ENDPOINT" \
    --only-show-errors --content-type "$type" \
    --cache-control "public, max-age=31536000, immutable"
done
