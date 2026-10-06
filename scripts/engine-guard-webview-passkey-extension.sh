#!/usr/bin/env bash
# Guard: a passkey extension answers a page's WebAuthn request in a <webview>.
# Patch 0048 removes the browser's own WebAuthn UI.
#
# Headless, with no compositor or client.
#
# Control: the same <webview> without the extension. The request must be
# refused, and the page must still find PublicKeyCredential.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-passkey-extension.sh
