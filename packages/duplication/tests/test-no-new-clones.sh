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

# A generated file's generator is its one definition, so the file is skipped.
# Each file that says near its top not to edit it is in `jscpd.json`'s
# `ignore`, and each file named there is generated.
GENERATED="$(git grep -lE "Do not|Don't" -- '*.ts' '*.tsx' '*.rs' '*.cc' '*.h' \
  ':!packages/domicile-engine/src/third_party/**' ':!packages/domicile-engine/upstream/**' |
  while read -r file; do
    head -5 "$file" | sed 's|^ *//[/!]* *||' | tr '\n' ' ' | grep -qE "(Do not|Don't) edit" &&
      printf '%s\n' "$file"
  done | sort)"
IGNORED="$(jq -r '.ignore[] | select(contains("*") | not)' "$PACKAGE/jscpd.json" | sort)"
[ "$GENERATED" = "$IGNORED" ] || {
  diff <(printf '%s\n' "$GENERATED") <(printf '%s\n' "$IGNORED") | sed -n 's/^< /generated, not in ignore: /p; s/^> /in ignore, not generated: /p'
  echo "FAIL: jscpd.json's ignore must list exactly the generated files"
  exit 1
}

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
