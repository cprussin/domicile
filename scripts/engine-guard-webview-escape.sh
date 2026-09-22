#!/usr/bin/env bash
# A plain Escape, pressed at a shell with a browser window on the page.
#
# The key that took a desktop down. A `<webview>` makes the shell's own
# WebContents an embedder, and until patch 0037 the browser process walked a
# null `BrowserPluginGuestManager` for an unhandled Escape and died on it —
# `upstream/browser-plugin-embedder-null-guest-manager.md` is the bug. Headless
# and software-composited like the keyboard guard, and the keystroke goes in
# over the same debugging port.
#
# Its control is neither of the shapes the other webview guards use, because
# what this guard claims is an ABSENCE: no signal dumped, and a browser still
# answering. An engine that survived and a guard that cannot see one that did
# not read exactly alike from inside the run — so the control keeps the whole
# setup and kills the browser process with SIGSEGV where the Escape would have
# gone, and both readings have to move.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-escape.sh
