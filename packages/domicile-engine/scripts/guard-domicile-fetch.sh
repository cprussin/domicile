#!/usr/bin/env bash
# Checks that a domicile:// document fetch()es its own files and no other page
# can read them.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-domicile-fetch.sh /build/chromium/src
#
# The shell fetches a file beside it and one from domicile://home/ (patch
# 0126). It then shows a web page in a <webview>, which tries to read the same
# two files with fetch(), a no-cors fetch() and XMLHttpRequest. The page must
# read neither: the subresource factory serves every frame
# (ShellURLLoaderFactory::MayReadFiles, MayReadHome). The shell reading both is
# the control, so a page reading nothing means the files are guarded rather
# than unreachable.
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
  annotate "guard-domicile-fetch: no path to chromium/src was given"
  exit 1
fi

OUT="${OUT:-out/Domicile}"
# Not any other guard's paths: CI runs the guards in one job.
BROKER="${BROKER:-/tmp/domicile-fetch-broker}"
PROFILE="${PROFILE:-/tmp/domicile-fetch-profile}"
HOME_DIR="${HOME_DIR:-/tmp/domicile-fetch-home}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-fetch-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-fetch-http.log}"
FOR_SECONDS="${FOR_SECONDS:-60}"
# The file both pages read: in the shell root, and copied into HOME_DIR.
FIXTURE="guard-domicile-fetch-file.txt"

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
  annotate "guard-domicile-fetch: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-domicile-fetch: no python3, and the page this checks is served by one"
  exit 77
}

rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-domicile-fetch-server.py" --port 0 >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
for _ in $(seq 1 60); do
  grep -q "serving" "$HTTP_LOG" 2>/dev/null && break
  sleep 0.25
done
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-domicile-fetch: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}

fresh_broker; rm -rf "$PROFILE" "$HOME_DIR"; mkdir -p "$PROFILE" "$HOME_DIR"
cp "$SCRIPTS/$FIXTURE" "$HOME_DIR/$FIXTURE"

rm -f "$ENGINE_LOG"
HOME="$HOME_DIR" "$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?src=http://127.0.0.1:$PORT/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-domicile-fetch.js" \
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
'"GUARD shell own=read home=read" "GUARD guest '*'=read'*)
  FAILURE="A WEB PAGE IN A <webview> READ A domicile:// FILE ($GUEST_SAID): ShellURLLoaderFactory must refuse it (MayReadFiles for the shell, MayReadHome for home)"
  ;;
'"GUARD shell own=read home=read" "GUARD guest '*)
  FAILURE=""
  ;;
'"GUARD shell own=read home=read" ')
  FAILURE="the <webview>'s page never reported: the guest was not created, or the page did not load"
  ;;
'"GUARD shell own=read '*)
  FAILURE="the shell could not fetch from domicile://home/ ($SHELL_SAID): MayReadHome refused the shell, or HOME did not reach the engine"
  ;;
'"GUARD shell '*)
  FAILURE="the control failed: the shell could not fetch its own file ($SHELL_SAID). Blink refuses fetch() on a scheme not registered as supporting the Fetch API (patch 0126), or MayReadFiles refused the shell's own origin"
  ;;
*)
  FAILURE="the shell never ran, or ran and never said so: DomicileShell did not run the module, or the module was refused"
  ;;
esac

echo "shell: $SHELL_SAID"
echo "page:  $GUEST_SAID"

if [ -n "$FAILURE" ]; then
  annotate_from "guard-domicile-fetch: $FAILURE" "$ENGINE_LOG"
  echo "guard-domicile-fetch: $FAILURE" >&2
  echo "the engine said:" >&2
  tail -40 "$ENGINE_LOG" >&2
  echo "what the server was asked for:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
fi
echo "PASS: the shell fetches its own files and home's, and a web page in a <webview> reads neither"
