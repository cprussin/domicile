#!/usr/bin/env bash
# Checks that the browser's notification bridge waits for a server that takes
# its name late.
#
# Domicile starts the engine before the compositor, which serves
# `org.freedesktop.Notifications`. Chrome's bridge looked for it once, so it
# could miss it and show its own popups all session.
#
# Reads the patches, not a Chromium tree, so it runs in the shell group.
# `guard-notification-server-late.sh` checks the same on a built engine.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCHES="$ROOT/packages/domicile-engine/patches"
[ -d "$PATCHES" ] || { echo "no patch series at $PATCHES" >&2; exit 1; }

FAILED=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n    %s\n' "$1" "$2"; FAILED=$((FAILED + 1)); }

BRIDGE="$(grep -al '^+++ b/chrome/browser/notifications/notification_platform_bridge_linux.cc' "$PATCHES"/*.patch)"
# shellcheck disable=SC2086 # one path per patch
if [ -n "$BRIDGE" ] && grep -aq '^+.*->WaitForServiceToBeAvailable(' $BRIDGE; then
  ok "the bridge waits for the server to take its name"
else
  fail "the bridge waits for the server to take its name" \
    "no patch has NotificationPlatformBridgeLinuxImpl call WaitForServiceToBeAvailable, so it looks for the server once"
fi

GUARD="$ROOT/scripts/engine-guard-notification-server-late.sh"
if [ -x "$GUARD" ] && grep -qF 'scripts/engine-guard-notification-server-late.sh' "$ROOT/scripts/check.sh"; then
  ok "the engine group runs guard-notification-server-late.sh"
else
  fail "the engine group runs guard-notification-server-late.sh" \
    "scripts/engine-guard-notification-server-late.sh is missing or not in check.sh's engine group"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
