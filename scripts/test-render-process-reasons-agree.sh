#!/usr/bin/env bash
# Checks that the four lists of why a page's renderer went away agree, in
# order.
#
# A reason crosses the mojom (`WebViewRenderProcess`), the browser
# (`RenderProcessName`, which also names why in the engine's line for a dead
# shell), the
# element (`renderProcessGone`) and the SDK
# (`WEBVIEW_RENDER_PROCESS_GONE_REASONS`). A reason missing from one reads as
# `""` in a shell, which means the page is running.
#
# This builds nothing, so it runs without a Chromium checkout.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/domicile-engine/src"
MOJOM="$SRC/components/domicile/mojom/web_view_guest.mojom"
BROWSER="$SRC/components/domicile/browser/render_process.cc"
ELEMENT="$SRC/third_party/blink/renderer/core/html/domicile/html_web_view_element.cc"
TS="$ROOT/packages/chrome-sdk/src/webview-element.ts"

for f in "$MOJOM" "$BROWSER" "$ELEMENT" "$TS"; do
  [ -f "$f" ] || { echo "no $f" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# mojom: the members of `enum WebViewRenderProcess` after `kRunning`,
# kebab-cased: `kCleanExit` is `clean-exit`.
sed -n '/^enum WebViewRenderProcess {$/,/^};$/p' "$MOJOM" |
  sed -n 's/^  k\([A-Za-z]*\),$/\1/p' |
  grep -v '^Running$' |
  sed -E 's/(.)([A-Z])/\1-\2/g' |
  tr '[:upper:]' '[:lower:]' >"$WORK/mojom"

# C++: each name a `RenderProcessName` switch returns, in case order. Both
# the browser's and the element's.
names_in() { # file, function
  sed -n "/^[^ ].* $2(/,/^}$/p" "$1" | sed -n 's/^ *return "\([a-z][a-z-]*\)";$/\1/p'
}
names_in "$BROWSER" RenderProcessName >"$WORK/browser"
names_in "$ELEMENT" RenderProcessName >"$WORK/element"

# TypeScript: the members of the list.
sed -n '/^export const WEBVIEW_RENDER_PROCESS_GONE_REASONS = \[$/,/^\] as const;$/p' "$TS" |
  sed -n 's/^  "\([a-z-]*\)",$/\1/p' >"$WORK/ts"

FAILED=0
for f in mojom browser element ts; do
  n="$(wc -l <"$WORK/$f" | tr -d ' ')"
  # A pattern that stops matching yields an empty list, which equals any
  # other empty list. Check the count first.
  if [ "$n" -lt 2 ]; then
    printf '  FAIL  read %s reasons from the %s list, so its pattern no longer matches\n' \
      "$n" "$f"
    FAILED=$((FAILED + 1))
  fi
done
[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }

compare() { # what, file a, file b
  if diff -u "$2" "$3" >"$WORK/diff"; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n' "$1"
    sed 's/^/    /' "$WORK/diff"
    FAILED=$((FAILED + 1))
  fi
}

echo "  ($(wc -l <"$WORK/mojom" | tr -d ' ') reasons)"
compare "the mojom's reasons are the browser's, in the same order" \
  "$WORK/mojom" "$WORK/browser"
compare "the browser's reasons are the element's, in the same order" \
  "$WORK/browser" "$WORK/element"
compare "the element's reasons are the SDK's, in the same order" \
  "$WORK/element" "$WORK/ts"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
