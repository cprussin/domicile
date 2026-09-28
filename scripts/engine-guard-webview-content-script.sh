#!/usr/bin/env bash
# An unpacked extension's content script, marking a page in a <webview> — the
# assumption `docs/architecture/EXTENSIONS.md` rests on.
#
# Headless, no compositor and no client, as the framing guard.
#
# Its control is two runs: the extension on the page top-level, which MUST
# mark it, then the <webview> without the extension, which must NOT. The first
# establishes the extension loads here at all; the second, that the mark is the
# content script's.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-content-script.sh
