#!/usr/bin/env bash
# A Chrome extension's content script, reaching a page in a <webview>.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-content-script.sh /build/chromium/src
#
# WHY THIS EXISTS. `docs/architecture/EXTENSIONS.md` rests on it: a browser
# window is a `WebViewGuest` in the default profile, so an installed
# extension's content scripts should run in it as in any tab. This is that
# assumption, asserted before anything is built on it.
#
# Headless and software-composited, as `guard-webview-framing.sh`: what this
# measures is a page's own colors, so there is no client and no compositor.
#
# THE EXTENSION is `guard-webview-content-script-extension/`, unpacked, loaded
# by `--load-extension`. Its content script matches `http://127.0.0.1/*` and
# paints the whole page `COLOR`. Current Chromium ignores `--load-extension`
# unless `DisableLoadExtensionCommandLineSwitch` is disabled, so every run
# disables it; one `--disable-features` only, since a second would replace it
# (see `domicile-launch`'s spawn.rs).
#
# WHAT IT ASSERTS. That `COLOR` is somewhere in the window, with the shell's
# background as the witness. Not where.
#
# HOW IT CAN FAIL. NEGATIVE=1 runs the control, presence first:
#
#   1. `extension`: the served page as the top-level `--app`, extension loaded.
#      It MUST show `COLOR`. This establishes that the extension loads and
#      injects in this harness at all.
#   2. `bare`: the claim's own <webview> page, extension NOT loaded. It MUST
#      NOT show `COLOR`, and its witness is the served page's own color, so the
#      absence is read off a guest that drew. This establishes that the color
#      comes from the content script and from nothing else.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-content-script: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# The mark. Fixed rather than overridable: `content.js` paints it, and
# `scripts/test-webview-content-script-guard.sh` holds the two together.
readonly COLOR="8E24AA"
# The shell's background, and the served page's own color. No other guard's,
# and no browser background.
WITNESS="${WITNESS:-2E3A1C}"
PAGE_COLOR="${PAGE_COLOR:-F9A825}"

EXTENSION="$SCRIPTS/guard-webview-content-script-extension"

FOR_SECONDS="${FOR_SECONDS:-60}"

OUT="${OUT:-out/Domicile}"
BROKER="${BROKER:-/tmp/domicile-webview-content-script-broker}"
PROFILE="${PROFILE:-/tmp/domicile-webview-content-script-profile}"
WIDTH="${WIDTH:-1024}"
HEIGHT="${HEIGHT:-768}"

HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-content-script-http.log}"

# Set by `measure`, read by the diagnostics at the foot.
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
  annotate "guard-webview-content-script: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
[ -x "$CHROMIUM/$OUT/domicile_color_probe" ] || {
  annotate "guard-webview-content-script: no domicile_color_probe in $CHROMIUM/$OUT; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-content-script: no python3, and the page this measures is served by one"
  exit 77
}

# One browser, one page, one answer: the probe's own status. The engine is
# killed on the way out, because the next leg opens the same socket.
measure() { # $1 which run, $2 the URL to open, $3 the witness, $4 "with" or "without" the extension
  local which="$1" url="$2" witness="$3" extension=()
  local engine_log="/tmp/domicile-webview-content-script-$which-engine.log"
  local probe_log="/tmp/domicile-webview-content-script-$which-probe.log"
  LAST_ENGINE_LOG="$engine_log"
  if [ "$4" = "with" ]; then
    extension=("--load-extension=$EXTENSION")
  fi

  rm -f "$BROKER"
  rm -rf "$PROFILE"
  mkdir -p "$PROFILE"

  # The framing guard's flags, plus the extension. The feature is disabled in
  # every run, so the legs differ in `--load-extension` and nothing else.
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="$url" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-content-script.js" \
    --disable-features=DisableLoadExtensionCommandLineSwitch \
    ${extension[@]+"${extension[@]}"} \
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
    annotate_from "guard-webview-content-script: the engine never opened its broker socket at $BROKER for the $which run" "$engine_log"
    echo "the engine said:" >&2
    tail -20 "$engine_log" >&2
    exit 1
  }
  echo "the engine is listening on $BROKER, showing $url, $4 the extension"

  LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$CHROMIUM/$OUT/domicile_color_probe" \
      --domicile-broker-socket="$BROKER" \
      --color="FF$COLOR" \
      --witness="FF$witness" \
      --for-seconds="$FOR_SECONDS" 2>&1 | tee "$probe_log"
  local status="${PIPESTATUS[0]}"

  kill "$engine" 2>/dev/null
  echo
  echo "the $which probe exited $status"
  return "$status"
}

# 1. The page. Its own server: `crux` reaches no arbitrary host.
python3 "$SCRIPTS/guard-webview-content-script-server.py" \
  --port 0 --color "$PAGE_COLOR" >"$HTTP_LOG" 2>&1 &
STARTED+=($!)

for _ in $(seq 1 60); do
  grep -q "serving" "$HTTP_LOG" 2>/dev/null && break
  sleep 0.25
done
grep -q "serving" "$HTTP_LOG" 2>/dev/null || {
  annotate_from "guard-webview-content-script: its page server never came up" "$HTTP_LOG"
  echo "the server said:" >&2
  tail -20 "$HTTP_LOG" >&2
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-content-script: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
PAGE="http://127.0.0.1:$PORT/page"
SHELL_PAGE="domicile://shell/?witness=$WITNESS&src=$PAGE"
echo "serving the page at $PAGE"

# 2. The runs.
#
#    THE BUDGET is the claim's. `bare` waits for an absence, so it has nothing
#    to stop it but its budget; the claim is the same <webview> on the same
#    page, run just before it by `engine_guard_and_control`, and how long its
#    mark took to show is how long a guest takes to draw here. `extension`
#    waits for a presence and stops when it arrives.
if [ "$NEGATIVE" = "1" ]; then
  measure extension "$PAGE" "$PAGE_COLOR" with
  EXTENSION_STATUS=$?
  FOR_SECONDS="$(budget_for webview-content-script "$FOR_SECONDS")" \
    measure bare "$SHELL_PAGE" "$PAGE_COLOR" without
  BARE_STATUS=$?
  MEASURED="control $EXTENSION_STATUS $BARE_STATUS"
else
  STARTED_AT="$(date +%s)"
  measure webview "$SHELL_PAGE" "$WITNESS" with
  WEBVIEW_STATUS=$?
  # Only on a pass: a failed run measured this script's patience, not a guest.
  if [ "$WEBVIEW_STATUS" -eq 0 ]; then
    budget_note webview-content-script "$(($(date +%s) - STARTED_AT))"
  fi
  MEASURED="webview $WEBVIEW_STATUS"
fi

echo
echo "measured: $MEASURED"

# WHICH END TO BLAME. `scripts/test-webview-content-script-guard.sh` runs this
# block directly.
FAILURE=""
PASSED=""
case "$MEASURED" in
"webview 0")
  PASSED="an extension's content script marked a page in a <webview>, so a \
guest is a page extensions reach"
  ;;
"webview 1")
  FAILURE="the <webview> showed no mark. The shell drew -- the witness is on \
it -- so either the guest never showed its page or the content script did not \
run in it. The control's first leg says whether the extension loads at all; \
the HTTP log says whether the guest asked for the page"
  ;;
"webview 2")
  FAILURE="nothing was measured: the shell's own background never appeared, \
so the browser drew no page at all. This is the harness, not the extension"
  ;;
"webview "*)
  FAILURE="the probe did not run for the claim ($MEASURED), so there is no \
measurement here of any kind"
  ;;
"control 0 1")
  PASSED="the control is sharp: the extension marked a top-level page, and \
the same <webview> without it drew its page unmarked -- so the claim's mark \
is the content script's"
  ;;
"control 0 0")
  FAILURE="the <webview> showed the mark with no extension loaded, so the \
color is not the content script's and the claim proves nothing. Check that \
no page this guard serves paints it"
  ;;
"control 0 2")
  FAILURE="the second leg measured nothing: the page in the <webview> never \
drew, so its missing mark is not a reading. The guest, or the harness; the \
first leg worked"
  ;;
"control 0 "*)
  FAILURE="the probe did not run for the control's second leg ($MEASURED), \
so it measured nothing against the first"
  ;;
"control 1 "*)
  FAILURE="the extension did not mark even a top-level page: the page drew, \
unmarked. So the extension is not loading or not injecting in this harness, \
and no <webview> result means anything. Check that --load-extension still \
works with DisableLoadExtensionCommandLineSwitch disabled, and the engine log \
for a manifest error"
  ;;
"control 2 "*)
  FAILURE="nothing was measured: the served page never drew as the \
top-level app. This is the harness, not the extension"
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

annotate "guard-webview-content-script: $FAILURE"
if [ -n "$LAST_ENGINE_LOG" ]; then
  echo "the engine's last words ($LAST_ENGINE_LOG):" >&2
  tail -30 "$LAST_ENGINE_LOG" >&2
fi
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
