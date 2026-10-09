#!/usr/bin/env bash
# Checks that `domicile://shell` runs script only from the shell root.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-script-src.sh /build/chromium/src
#
# The shell document is served with `Content-Security-Policy: script-src
# 'self'` (ShellURLLoaderFactory::ShellDocumentHead). The page adds an inline
# `<script>` and an `<img onerror=...>`, as markup from a notification body or
# window title could, and both must not run. Its control is in the same run: a
# `<script src>` from the shell root must run, so the page can see a script
# run. See docs/SHELL-SYSTEM-ACCESS.md#security.
#
# Headless, with no compositor or client.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-script-src: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-shell-script-src-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-script-src-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shell-script-src-engine.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shell-script-src: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shell-script-src.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# No early exit when it never comes: the verdict below says why, with the
# engine's log.
for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qF "GUARD script-src " "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
MEASURED=$(grep -oE '"GUARD script-src [^"]*"' "$ENGINE_LOG" | head -1)

case "$MEASURED" in
'"GUARD script-src inline=blocked handler=blocked self=ran"')
  FAILURE=""
  ;;
"")
  FAILURE="the shell never ran, or ran and never said so: DomicileShell did not run the module, or the module was refused"
  ;;
*'self=blocked"')
  FAILURE="the control failed: a script from the shell root did not run, so shells cannot load their own chunks, and this page cannot see a script run"
  ;;
*)
  FAILURE="injected script ran ($MEASURED): the shell document is not served with script-src 'self'"
  ;;
esac

echo "page: $MEASURED"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-shell-script-src: $FAILURE" "$ENGINE_LOG"
  echo "guard-shell-script-src: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: injected script does not run in the shell, and the shell root's does"
