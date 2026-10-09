#!/usr/bin/env bash
# Tests that every engine guard and spike starts Chrome with
# --disable-component-update.
#
# Otherwise each engine downloads components into
# $TMPDIR/.org.chromium.Chromium.chromium_chrome_url_fetcher_.*, 85-195M each.
# A guard stops its engine before the download finishes, so the directory
# stays. On crux that is the runner's tmpfs /tmp, which is RAM.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"

checked=0
failed=0
for script in "$SCRIPTS"/*.sh; do
  launches=$(grep -c 'OUT/chrome" \\$' "$script")
  [ "$launches" -gt 0 ] || continue
  checked=$((checked + launches))
  disabled=$(grep -c -- '--disable-component-update' "$script")
  if [ "$disabled" -ne "$launches" ]; then
    echo "FAIL: $(basename "$script") starts Chrome $launches times and passes --disable-component-update $disabled times" >&2
    failed=1
  fi
done

# Zero checks means the pattern stopped matching.
if [ "$checked" -eq 0 ]; then
  echo "FAIL: found no Chrome launch under $SCRIPTS" >&2
  exit 1
fi
[ "$failed" -eq 0 ] || exit 1
echo "ok: all $checked Chrome launches in guards and spikes disable component updates"
