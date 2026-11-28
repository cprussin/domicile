#!/usr/bin/env bash
# Fails on code copied from one place to another in TypeScript, Rust or the
# engine's C++, as jscpd finds it (`../jscpd.json`: 8 lines, 70 tokens).
#
# `../clones-baseline.json` lists the clones there were when this check
# landed, by fingerprint. A clone not in it fails the run; so does the
# baseline naming a clone that is gone, so folding one shrinks the list
# rather than leaving room for another. Once a clone is folded:
#
#   bun run clones:baseline   (in packages/duplication)
set -u

PACKAGE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$PACKAGE/../.." && pwd)"
JSCPD="$PACKAGE/node_modules/.bin/jscpd"
[ -x "$JSCPD" ] || {
  echo "FAIL: $JSCPD is missing; run bun install"
  exit 1
}
cd "$ROOT"

REPORT="$(mktemp -d)"
trap 'rm -rf "$REPORT"' EXIT
"$JSCPD" --config "$PACKAGE/jscpd.json" --baseline "$PACKAGE/clones-baseline.json" \
  --reporters json --output "$REPORT" . >/dev/null 2>&1
NEW="$(jq -r '.duplicates[] | select(.isNew)
  | "\(.firstFile.name):\(.firstFile.start)-\(.firstFile.end) = \(.secondFile.name):\(.secondFile.start)-\(.secondFile.end)"' \
  "$REPORT/jscpd-report.json")" || {
  echo "FAIL: jscpd wrote no report"
  exit 1
}
[ -z "$NEW" ] || {
  printf '%s\n' "$NEW"
  echo "FAIL: code copied from elsewhere (above); fold each into one definition"
  exit 1
}

CURRENT="$REPORT/baseline.json"
cp "$PACKAGE/clones-baseline.json" "$CURRENT"
"$JSCPD" --config "$PACKAGE/jscpd.json" --baseline "$CURRENT" --update-baseline \
  --reporters silent . >/dev/null 2>&1
[ "$(jq -S .fingerprints "$CURRENT")" = "$(jq -S .fingerprints "$PACKAGE/clones-baseline.json")" ] || {
  echo "FAIL: clones-baseline.json names clones that are gone; run bun run clones:baseline in packages/duplication"
  exit 1
}

echo "PASS: no clones beyond the $(jq '[.fingerprints[]] | add' "$PACKAGE/clones-baseline.json") in clones-baseline.json"
