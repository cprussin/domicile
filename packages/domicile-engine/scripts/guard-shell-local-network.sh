#!/usr/bin/env bash
# Checks that the shell can fetch a picture from this machine without a Local
# Network Access prompt.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-local-network.sh /build/chromium/src
#
# The launcher fetches bookmark favicons, including from LAN and localhost.
# domicile:// has no IP address, so LNA would treat the shell as public and
# prompt. Patch 0066 classes the shell as loopback.
#
# Headless and software-composited, like guard-webview-framing.sh.
#
# Asserts that the picture's color is on the shell's page.
#
# NEGATIVE=1 runs two legs on a plain http page marked public
# (`--ip-address-space-overrides`):
#
#   1. a picture from the page's own server must show, proving the harness
#      can see it
#   2. a picture from the loopback server must not, proving LNA is active
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-local-network: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# Unique to this guard and unlike any browser background.
COLOR="${COLOR:-2E8B57}"
WITNESS="${WITNESS:-4A3020}"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-shell-local-network-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-local-network-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

# PAGES is marked public; PICTURES stays loopback.
PAGES_LOG="${PAGES_LOG:-/tmp/domicile-shell-local-network-pages.log}"
PICTURES_LOG="${PICTURES_LOG:-/tmp/domicile-shell-local-network-pictures.log}"

LAST_ENGINE_LOG=""

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shell-local-network: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-shell-local-network: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shell-local-network: no python3, and the pictures this measures are served by one"
  exit 77
}

# Runs the engine on one URL and returns the probe's status. Runs differ only
# in the URL.
measure() { # $1 which run, $2 the URL to open
  local which="$1" url="$2"
  local engine_log="/tmp/domicile-shell-local-network-$which-engine.log"
  local probe_log="/tmp/domicile-shell-local-network-$which-probe.log"
  LAST_ENGINE_LOG="$engine_log"

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"

  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="$url" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-shell-local-network.js" \
    --ip-address-space-overrides="127.0.0.1:$PAGES_PORT=public" \
    --no-sandbox --password-store=basic --no-first-run \
    --user-data-dir="$PROFILE" \
    --window-size="$WIDTH,$HEIGHT" \
    --enable-logging=stderr --log-level=0 \
    --domicile-broker-socket="$BROKER" >"$engine_log" 2>&1 &
  local engine=$!
  STARTED+=("$engine")

  for _ in $(seq 1 240); do
    [ -S "$BROKER" ] && break
    sleep 0.5
  done
  [ -S "$BROKER" ] || {
    annotate_from "guard-shell-local-network: the engine never opened its broker socket at $BROKER for the $which run" "$engine_log"
    echo "the engine said:" >&2
    tail -20 "$engine_log" >&2
    exit 1
  }
  echo "the engine is listening on $BROKER, showing $url"

  LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$CHROMIUM/$OUT/domicile_color_probe" \
      --domicile-broker-socket="$BROKER" \
      --color="FF$COLOR" \
      --witness="FF$WITNESS" \
      --for-seconds="$FOR_SECONDS" 2>&1 | tee "$probe_log"
  local status="${PIPESTATUS[0]}"

  kill "$engine" 2>/dev/null
  echo
  echo "the $which probe exited $status"
  return "$status"
}

serve() { # $1 its log; prints the port it took
  local log="$1"
  for _ in $(seq 1 60); do
    grep -q "serving" "$log" 2>/dev/null && break
    sleep 0.25
  done
  served_port "$log" || {
    annotate_from "guard-shell-local-network: a picture server never said which port it took" "$log"
    tail -20 "$log" >&2
    exit 1
  }
}

# 1. The servers.
rm -f "$PAGES_LOG"
python3 "$SCRIPTS/guard-shell-local-network-server.py" \
  --port 0 --color "$COLOR" --witness "$WITNESS" >"$PAGES_LOG" 2>&1 &
STARTED+=($!)
rm -f "$PICTURES_LOG"
python3 "$SCRIPTS/guard-shell-local-network-server.py" \
  --port 0 --color "$COLOR" --witness "$WITNESS" >"$PICTURES_LOG" 2>&1 &
STARTED+=($!)
PAGES_PORT="$(serve "$PAGES_LOG")" || exit 1
PICTURES_PORT="$(serve "$PICTURES_LOG")" || exit 1
PAGES="http://127.0.0.1:$PAGES_PORT"
PICTURES="http://127.0.0.1:$PICTURES_PORT"
echo "pages at $PAGES (public), pictures at $PICTURES (loopback)"

# 2. The runs. The control's first leg must pass before the second means
#    anything.
if [ "$NEGATIVE" = "1" ]; then
  LEG_STARTED="$(date +%s)"
  measure same-space "$PAGES/shows?src=$PAGES/picture"
  SAME_STATUS=$?
  if [ "$SAME_STATUS" -eq 0 ]; then
    budget_note shell-local-network "$(($(date +%s) - LEG_STARTED))"
  fi

  FOR_SECONDS="$(budget_for shell-local-network "$FOR_SECONDS")" \
    measure into-loopback "$PAGES/shows?src=$PICTURES/picture"
  INTO_STATUS=$?
  MEASURED="control $SAME_STATUS $INTO_STATUS"
else
  measure shell "domicile://shell/?witness=$WITNESS&src=$PICTURES/picture"
  MEASURED="shell $?"
fi

echo
echo "measured: $MEASURED"

# scripts/test-shell-local-network-guard.sh runs this block directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"shell 0")
  PASSED="the shell showed a picture from this machine, so Local Network \
Access did not hold its request"
  ;;
"shell 1")
  FAILURE="the shell drew but the picture did not. Local Network Access held \
the request -- the shell is not classed loopback (patch 0066) -- or the \
server was never asked; its log says which"
  ;;
"shell 2")
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not LNA"
  ;;
"shell "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 0 1")
  PASSED="the control is sharp: a public page showed a picture from its own \
address space and not one from loopback, so LNA is live in this engine and \
the shell's picture is the shell being exempt"
  ;;
"control 0 0")
  FAILURE="a public page showed a picture from loopback, so Local Network \
Access is not holding anything in this engine and the shell showing one says \
nothing. Check the override and that LocalNetworkAccessChecks is enabled"
  ;;
"control 0 2")
  FAILURE="the loopback leg measured nothing: its own page never drew, so \
the picture being absent is not a reading. This is the harness"
  ;;
"control 0 "*)
  FAILURE="the probe did not run for the control's loopback leg \
($MEASURED), so nothing was measured against the first leg"
  ;;
"control 1 "*)
  FAILURE="the control's first leg showed nothing: a page did not show a \
picture from its own server, so this harness cannot see the picture at all \
and an absent one proves nothing"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the control's own page never appeared. \
This is the harness, not LNA"
  ;;
*)
  FAILURE="there is no measurement here of any kind ($MEASURED) -- the probe \
did not run, or ran for something this guard does not know how to read"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate "guard-shell-local-network: $FAILURE"
if [ -n "$LAST_ENGINE_LOG" ]; then
  echo "the engine's last words ($LAST_ENGINE_LOG):" >&2
  last_words "$LAST_ENGINE_LOG" >&2
fi
echo "what the page server was asked for:" >&2
tail -20 "$PAGES_LOG" >&2
echo "what the picture server was asked for:" >&2
tail -20 "$PICTURES_LOG" >&2
exit 1
