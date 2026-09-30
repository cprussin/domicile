#!/usr/bin/env bash
# A passkey extension answering a page's WebAuthn request in a <webview>, in
# place of the browser's own UI, which patch 0048 does not draw.
#
# Headless, no compositor and no client, as the content-script guard.
#
# Its control is the same <webview> without the extension, which must be
# refused -- and must find PublicKeyCredential to be refused at all.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-passkey-extension.sh
