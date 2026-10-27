#!/usr/bin/env bash
# Checks that a PDF the shell shows reaches the viewer with no tab id.
#
# The PDF viewer asks chrome.tabs about its stream's tab, and never starts if
# chrome.tabs does not know it. On a desk the shell is no tab, so the
# launcher's preview of a PDF is empty unless patch 0154 asks the desk whether
# the stream's WebContents is a tab.
#
# Reads `src/` and the patches, not a Chromium tree, so it runs in the shell
# group. `guard-shell-pdf.sh` checks the viewer starts on a built engine.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine"
PATCHES="$ENGINE/patches"
HOOKS="$ENGINE/src/chrome/browser/extensions/domicile_desk_hooks"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

DISPATCH="$(grep -al '^+++ b/chrome/browser/extensions/api/mime_handlers/dispatch_mime_handler_event.cc' "$PATCHES"/*.patch)"
if [ -n "$DISPATCH" ] &&
  # shellcheck disable=SC2086 # one path per patch
  grep -aqF '+  const int tab_id = domicile_desk::IsTab(*web_contents)' $DISPATCH &&
  # shellcheck disable=SC2086
  grep -aqF '+                         : extension_misc::kUnknownTabId;' $DISPATCH; then
  ok "a stream outside a desk tab has no tab id"
else
  fail "a stream outside a desk tab has no tab id" \
    "no patch makes SendExecuteMimeTypeHandlerEvent ask domicile_desk::IsTab, so the shell's PDF viewer asks chrome.tabs for a tab the desk does not know"
fi

if grep -qx 'bool IsTab(content::WebContents& contents);' "$HOOKS.h" &&
  grep -qx 'bool IsTab(content::WebContents& contents) {' "$HOOKS.cc"; then
  ok "the desk hooks say whether a WebContents is a tab"
else
  fail "the desk hooks say whether a WebContents is a tab" \
    "domicile_desk_hooks does not declare and define IsTab"
fi

if grep -qx '  guard-shell-pdf' "$ENGINE/scripts/run-checks.sh"; then
  ok "test:engine runs guard-shell-pdf.sh"
else
  fail "test:engine runs guard-shell-pdf.sh" \
    "run-checks.sh does not list guard-shell-pdf"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
