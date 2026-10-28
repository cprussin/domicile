#!/usr/bin/env bash
# Checks that Chrome's PDF viewer starts on a PDF the shell shows, as the
# launcher's preview does.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-pdf.sh /build/chromium/src
#
# The viewer asks chrome.tabs about its stream's tab, and never starts if
# chrome.tabs does not know it. On a desk the shell is no tab, so patch 0154
# gives a stream outside a <webview> no tab id. `guard-shell-pdf-viewer.py`
# asks the viewer's frame over the debugging port whether it started.
#
# Headless, with no compositor or client. HOME is a directory this makes, so
# domicile://home/ serves only its fixture.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-pdf: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-shell-pdf-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-pdf-profile}"
HOME_DIR="${HOME_DIR:-/tmp/domicile-shell-pdf-home}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shell-pdf-engine.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"
FIXTURE="guard-shell-pdf.pdf"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
  rm -rf "$HOME_DIR"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shell-pdf: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shell-pdf: no python3, and the viewer is asked by one"
  exit 77
}

fresh_broker; rm -rf "$PROFILE" "$HOME_DIR"; mkdir -p "$PROFILE" "$HOME_DIR"
cp "$SCRIPTS/$FIXTURE" "$HOME_DIR/$FIXTURE"

rm -f "$ENGINE_LOG"
HOME="$HOME_DIR" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shell-pdf.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))
LOADED=""
for _ in $(seq 1 "$TRIES"); do
  if grep -qF "GUARD pdf-frame-loaded" "$ENGINE_LOG" 2>/dev/null; then
    LOADED=1
    break
  fi
  sleep 0.25
done

MEASURED=""
if [ -n "$LOADED" ]; then
  if DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")"; then
    MEASURED="$(python3 "$SCRIPTS/guard-shell-pdf-viewer.py" \
      --port "$DEBUG_PORT" --tries "$((FOR_SECONDS * 2))")"
  else
    MEASURED="no-port"
  fi
fi

case "$MEASURED" in
viewer=ready)
  FAILURE=""
  ;;
viewer=stuck)
  FAILURE="the PDF viewer loaded and never started: its stream named a tab chrome.tabs does not know (patch 0154), so its zoom lookup failed"
  ;;
viewer=absent)
  FAILURE="the PDF never reached the viewer: the <iframe> loaded, but no frame of the PDF extension came up"
  ;;
no-port)
  FAILURE="the engine never said which debugging port it took"
  ;;
*)
  FAILURE="the shell's <iframe> never loaded: DomicileShell did not run the module, or domicile://home/ refused the PDF"
  ;;
esac

echo "viewer: ${MEASURED:-never asked}"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-shell-pdf: $FAILURE" "$ENGINE_LOG"
  echo "guard-shell-pdf: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  exit 1
fi
echo "PASS: the PDF viewer starts on a PDF the shell shows"
