#!/usr/bin/env bash
# Tests foreign_allowlist.py, which lists the string ids every locale but
# en-US is packed with: everything except Chrome's own UI, which a desk never
# shows.
#
# Reads grit's `.pak.info` lines (`name,id,source`) and prints one id a line.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/packages/domicile-engine/src/components/domicile/locales/foreign_allowlist.py"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat >"$WORK/generated_resources_en-US.pak.info" <<'INFO'
IDS_SETTINGS_TITLE,800,../../chrome/app/settings_strings.grdp
IDS_NTP_TITLE,801,../../chrome/app/generated_resources.grd
IDS_DOWNLOAD_TITLE,802,../../chrome/app/generated_resources.grd
INFO
cat >"$WORK/blink_strings_en-US.pak.info" <<'INFO'
IDS_FORM_VALIDATION_VALUE_MISSING,900,../../third_party/blink/public/strings/blink_strings.grd
INFO

failed=0
OUT="$WORK/allowlist.txt"
python3 -I "$SCRIPT" "$OUT" "$WORK/generated_resources_en-US.pak.info" \
  "$WORK/blink_strings_en-US.pak.info" || {
  echo "FAIL: foreign_allowlist.py exited $?" >&2
  exit 1
}

expect() {
  local want="$1" why="$2"
  if [ "$(cat "$OUT")" != "$want" ]; then
    echo "FAIL: $why" >&2
    echo "  want: $(echo "$want" | tr '\n' ' ')" >&2
    echo "  got:  $(tr '\n' ' ' <"$OUT")" >&2
    failed=1
  fi
}

# 800 is a dropped source and 801 a dropped name prefix. 802 and 900 are kept.
expect "$(printf '802\n900')" "kept ids are not the ids outside Chrome's own UI"

[ "$failed" -eq 0 ] || exit 1
echo "ok: foreign locales keep every string but Chrome's own UI"
