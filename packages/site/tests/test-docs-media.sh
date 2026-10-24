#!/usr/bin/env bash
# Asserts the docs media scripts refuse what they must not do, before they
# start a compositor or push.
#
# - `docs-media.sh` names a scene that does not exist, rather than capturing
#   nothing.
# - The write-back never pushes to a branch the repository releases from.
#
# The captures themselves need a render node and run on `crux`
# (`docs-media.yml`).
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
CAPTURE="$ROOT/packages/site/scripts/docs-media.sh"
WRITEBACK="$ROOT/.github/scripts/docs-media-writeback.sh"

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

[ "$FAILED" -eq 0 ] || exit 1
echo "all ok"
