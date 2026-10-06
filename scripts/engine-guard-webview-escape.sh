#!/usr/bin/env bash
# Guard: a plain Escape pressed in a shell that shows a browser window.
#
# A `<webview>` makes the shell's WebContents an embedder, and the browser
# process crashed on an unhandled Escape with a null
# `BrowserPluginGuestManager`. Patch 0037 fixes it; see
# `packages/domicile-engine/upstream/browser-plugin-embedder-null-guest-manager.md`.
# Headless and software-composited; the key goes in over the debugging port.
#
# The claim is an absence: no crash signal, and the browser still answers. The
# control runs the same setup and kills the browser with SIGSEGV where the
# Escape would go, so both readings must change.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-escape.sh
