#!/usr/bin/env bash
# Tests that every engine guard and spike starts Chrome with
# --disable-component-update, directly or through `domicile`'s
# `DOMICILE_ENGINE_ARGS`.
#
# Otherwise each engine downloads components into
# $TMPDIR/.org.chromium.Chromium.chromium_chrome_url_fetcher_.*, 85-195M each.
# A guard stops its engine before the download finishes, so the directory
# stays. On crux that is the runner's tmpfs /tmp, which is RAM.
#
# A guard that measures the updater itself marks its launch with
# `# component updates on:` and gives the engine a TMPDIR of its own, which
# its cleanup removes on a line of its own, so its downloads go with it.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"

checked=0
kept=0
failed=0
for script in "$SCRIPTS"/*.sh; do
  launches=$(( $(grep -c 'OUT/chrome" \\$' "$script") +
                $(grep -c '^ *DOMICILE_ENGINE_ARGS=' "$script") ))
  [ "$launches" -gt 0 ] || continue
  checked=$((checked + launches))
  disabled=$(grep -c -- '--disable-component-update' "$script")
  if grep -q '^# component updates on:' "$script"; then
    # shellcheck disable=SC2016 # the guard's own text, unexpanded
    if ! grep -qF 'TMPDIR="$ENGINE_TMP" "$CHROMIUM/$OUT/chrome"' "$script" ||
      ! grep -qxF '  rm -rf "$ENGINE_TMP"' "$script"; then
      echo "FAIL: $(basename "$script") keeps component updates on but does not start Chrome with TMPDIR=\"\$ENGINE_TMP\" and remove it" >&2
      failed=1
    fi
    kept=$((kept + launches))
    continue
  fi
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
echo "ok: all $((checked - kept)) other Chrome launches in guards and spikes disable component updates, and $kept that keeps them on cleans up after them"
