#!/usr/bin/env bash
# Checks that <app> exists in the shell and nowhere else.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-app-only-in-shell.sh /build/chromium/src
#
# The shell and a web page in its <webview> each report whether they have the
# element, its interface and canvas.embedExternalSurface(). The page must have
# none of them: an <app> there could embed any window and take its pixels from
# the shell. The shell having all three is the control, so a page reporting
# none means the feature is gated rather than broken.
#
# Headless, with no compositor or client.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-app-only-in-shell: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-app-only-in-shell-broker}"
PROFILE="${PROFILE:-/tmp/domicile-app-only-in-shell-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-app-only-in-shell-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-app-only-in-shell-http.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-app-only-in-shell: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-app-only-in-shell: no python3, and the page this checks is served by one"
  exit 77
}

rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-app-only-in-shell-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
for _ in $(seq 1 60); do
  grep -q "serving" "$HTTP_LOG" 2>/dev/null && break
  sleep 0.25
done
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-app-only-in-shell: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

rm -f "$BROKER"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=http://127.0.0.1:$PORT/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-app-only-in-shell.js" \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

# No early exit when it never comes: the verdict below says why, with the
# engine's log.
for _ in $(seq 1 $((FOR_SECONDS * 4))); do
  grep -qF "GUARD guest " "$ENGINE_LOG" 2>/dev/null && break
  sleep 0.25
done

# The closing quote is Chromium's and keeps each match on the message: see
# guard-windows-state.sh.
SHELL_SAID=$(grep -oE '"GUARD shell [^"]*"' "$ENGINE_LOG" | head -1)
GUEST_SAID=$(grep -oE '"GUARD guest [^"]*"' "$ENGINE_LOG" | head -1)
MEASURED="$SHELL_SAID $GUEST_SAID"

case "$MEASURED" in
'"GUARD shell element=app interface=defined embed=defined" "GUARD guest element=unknown interface=undefined embed=undefined"')
  FAILURE=""
  ;;
'"GUARD shell element=app interface=defined embed=defined" "GUARD guest '*)
  FAILURE="a web page in a <webview> has part of <app> ($GUEST_SAID): DomicileExternalSurface is on outside domicile://shell/"
  ;;
'"GUARD shell element=app interface=defined embed=defined" ')
  FAILURE="the <webview>'s page never reported: the guest was not created, or the page did not load"
  ;;
'"GUARD shell '*)
  FAILURE="the control failed: the shell lacks part of <app> ($SHELL_SAID), so DomicileShell did not turn DomicileExternalSurface on"
  ;;
*)
  FAILURE="the shell never ran, or ran and never said so: DomicileShell did not run the module, or the module was refused"
  ;;
esac

echo "shell: $SHELL_SAID"
echo "page:  $GUEST_SAID"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-app-only-in-shell: $FAILURE" "$ENGINE_LOG"
  echo "guard-app-only-in-shell: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  echo "what the server was asked for:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
fi
echo "PASS: the shell has <app>, and a web page in a <webview> does not"
