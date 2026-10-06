#!/usr/bin/env bash
# Checks that an unpacked extension's content script marks a page in a
# <webview>, which `docs/architecture/EXTENSIONS.md` relies on.
#
# Headless, with no compositor or client.
#
# The control is two runs: the extension on a top-level page must mark it,
# showing it loads; the <webview> without the extension must not be marked.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-content-script.sh
