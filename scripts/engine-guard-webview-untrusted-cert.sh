#!/usr/bin/env bash
# Guard: a <webview> on an https page with an untrusted certificate reports
# `security` as `dangerous`.
# Control: the same certificate, trusted, loads the page and reads `secure`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

engine_guard_and_control guard-webview-untrusted-cert.sh
