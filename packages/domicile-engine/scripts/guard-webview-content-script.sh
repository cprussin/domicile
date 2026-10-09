#!/usr/bin/env bash
# Guard: an extension's content script runs in a page in a <webview>.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-content-script.sh /build/chromium/src
#
# `docs/architecture/EXTENSIONS.md` assumes this: a browser window is a
# `WebViewGuest` in the default profile, so content scripts run in it as in a
# tab. Runs headless with software compositing.
#
# The extension in `guard-webview-content-script-extension/` paints any
# `http://127.0.0.1/*` page `COLOR`. The guard asserts `COLOR` appears in the
# window, with the shell's background as the witness.
#
# Chromium ignores `--load-extension` unless
# `DisableLoadExtensionCommandLineSwitch` is disabled. Pass only one
# `--disable-features`; a second replaces the first (see `domicile-launch`'s
# spawn.rs).
#
# NEGATIVE=1 runs the control:
#
#   1. `extension`: the page as the top-level `--app` with the extension. Must
#      show `COLOR`, proving the extension loads and injects.
#   2. `bare`: the <webview> page without the extension. Must not show
#      `COLOR`. Its witness is the page's own color, so the guest did draw.
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
  annotate "guard-webview-content-script: no path to chromium/src was given"
  exit 1
fi

NEGATIVE="${NEGATIVE:-0}"

# Not overridable: must match `content.js`, which
# `scripts/test-webview-content-script-guard.sh` checks.
readonly COLOR="8E24AA"
# Colors no other guard or browser default uses.
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

# Runs one engine and returns the color probe's status. Kills the engine after,
# since the next run reuses the socket.
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

  # The feature is disabled in every run, so runs differ only in
  # `--load-extension`.
  rm -f "$engine_log"
  "$CHROMIUM/$OUT/chrome" \
    --ozone-platform=headless \
    --disable-gpu \
    --app="$url" \
    --domicile-shell-root="$SCRIPTS" \
    --domicile-shell-module="guard-webview-content-script.js" \
    --disable-features=DisableLoadExtensionCommandLineSwitch \
    ${extension[@]+"${extension[@]}"} \
    --no-sandbox --password-store=basic --no-first-run --disable-component-update \
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

# 1. Serve the page locally; `crux` cannot reach external hosts.
rm -f "$HTTP_LOG"
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
#    `bare` waits for an absence, so it runs for the time the positive run
#    took to see its mark (recorded by `budget_note`).
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
  # Only on a pass: a failed run's duration is just the timeout.
  if [ "$WEBVIEW_STATUS" -eq 0 ]; then
    budget_note webview-content-script "$(($(date +%s) - STARTED_AT))"
  fi
  MEASURED="webview $WEBVIEW_STATUS"
fi

echo
echo "measured: $MEASURED"

# Turn the statuses into a verdict.
# `scripts/test-webview-content-script-guard.sh` tests this block.
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
  last_words "$LAST_ENGINE_LOG" >&2
fi
echo "what the server was asked for:" >&2
tail -20 "$HTTP_LOG" >&2
exit 1
