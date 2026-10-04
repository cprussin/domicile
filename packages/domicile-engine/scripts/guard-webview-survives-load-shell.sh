#!/usr/bin/env bash
# A browser window's page, alive across `domicile load-shell`.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-webview-survives-load-shell.sh /build/chromium/src
#
# Headless and software-composited like the other <webview> guards. It reads
# the browser's log for whether one page kept running, so it needs no pixels
# and no client.
#
# Why: `domicile load-shell` reloads the shell's page. The browser owns
# browser windows' pages (src/components/domicile/mojom/browser_windows.mojom),
# so a reloaded shell gets the same list and draws the same pages.
#
# The shell opens one browser window at a page that picks a token on load and
# ticks with it. The guard sends `load_shell`, naming the same shell, to the
# engine's command socket. Then it asserts:
#
#   the engine answered `loaded`     the command reached the engine and the
#                                    shell was shown again
#   the shell loaded twice           the reload happened
#   the page loaded once             the claim: one token for the whole run,
#                                    so the page was never recreated
#   the new shell shows it           the second shell's <webview> says it
#                                    shows the page, so the window was
#                                    attached, not just kept alive
#   the page kept ticking            the same page is still running after its
#                                    frame went
#
# Control: NEGATIVE=1 shows the same page in a `<webview src>`, the shell
# document's own page. The reload must load it again, giving a second token.
# Without this, a reload that reloaded nothing, or a miscounted page, would
# read one token in both runs.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-webview-survives-load-shell: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 shows the page in the shell's own <webview src>. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="window"
[ "$NEGATIVE" = "1" ] && MODE="own"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-webview-survives-load-shell$WHICH-broker}"
COMMAND="${COMMAND:-/tmp/domicile-webview-survives-load-shell$WHICH-command}"
PROFILE="${PROFILE:-/tmp/domicile-webview-survives-load-shell$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-webview-survives-load-shell$WHICH-engine.log}"
HTTP_LOG="${HTTP_LOG:-/tmp/domicile-webview-survives-load-shell$WHICH-http.log}"
FOR_SECONDS="${FOR_SECONDS:-120}"

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
  rm -rf "$PROFILE"
  rm -f "$COMMAND"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-webview-survives-load-shell: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-webview-survives-load-shell: no python3, and the page and the command are both driven by one"
  exit 77
}

rm -f "$BROKER" "$COMMAND"; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -qF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

# 1. The page, on its own server like every <webview> guard's: `crux` reaches
#    no arbitrary host.
rm -f "$HTTP_LOG"
python3 "$SCRIPTS/guard-webview-survives-load-shell-server.py" --port 0 \
  >"$HTTP_LOG" 2>&1 &
STARTED+=($!)
wait_for_line 240 "serving" "$HTTP_LOG" || {
  annotate_from "guard-webview-survives-load-shell: its page server never came up" "$HTTP_LOG"
  exit 1
}
PORT="$(served_port "$HTTP_LOG")" || {
  annotate_from "guard-webview-survives-load-shell: its page server never said which port it took" "$HTTP_LOG"
  exit 1
}
SUBJECT="http://127.0.0.1:$PORT"

# 2. The engine, with the command socket `domicile load-shell` uses.
rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --app="domicile://shell/?mode=$MODE&src=$SUBJECT/page" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-webview-survives-load-shell.js" \
  --domicile-command-socket="$COMMAND" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
STARTED+=($!)

TRIES=$((FOR_SECONDS * 4))

# 3. Wait for a few ticks, so "kept ticking" below measures a change and not
#    a late first tick.
wait_for_line "$TRIES" "GUARD tick token=" "$ENGINE_LOG" ||
  echo "the page never ticked; the verdict below says what that means" >&2
sleep 1

# 4. The swap: load the same shell over itself by sending the supervisor's
#    `domicile load-shell` line to the engine's socket.
BEFORE="$(grep -c -F "GUARD tick token=" "$ENGINE_LOG" 2>/dev/null || true)"
ANSWER="$(python3 - "$COMMAND" "$SCRIPTS" <<'EOF' 2>&1
import json, socket, sys

path, root = sys.argv[1], sys.argv[2]
line = json.dumps({"type": "load_shell", "version": 1, "root": root,
                   "module": "guard-webview-survives-load-shell.js"})
try:
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(10)
    connection.connect(path)
    connection.sendall((line + "\n").encode())
    print(connection.makefile().readline().strip())
except OSError as failure:
    print("no answer: %s" % failure)
EOF
)"
echo "the engine answered: $ANSWER"

# 5. Wait for the second shell, then watch for ticks. Two bounds (the second
#    load, then a fixed watch) because the control expects an absence: the
#    first page stops.
for _ in $(seq 1 "$TRIES"); do
  [ "$(grep -c -F "GUARD shell-loaded" "$ENGINE_LOG" 2>/dev/null)" -ge 2 ] && break
  sleep 0.25
done
sleep 3

# The readings, all from the engine's log.
ANSWERED=0
[ "$ANSWER" = '{"type":"loaded"}' ] && ANSWERED=1
LOADS="$(grep -c -F "GUARD shell-loaded" "$ENGINE_LOG" 2>/dev/null || true)"
TOKENS="$(sed -n 's/.*GUARD page-loaded token=\([a-z0-9]*\).*/\1/p' "$ENGINE_LOG" | sort -u | wc -l | tr -d ' ')"
FIRST="$(sed -n 's/.*GUARD page-loaded token=\([a-z0-9]*\).*/\1/p' "$ENGINE_LOG" | head -1)"
# Whether the new shell's <webview> says it shows the page: a `shown` line
# after the second `shell-loaded`.
SHOWN="$(awk -v want="GUARD shown url=$SUBJECT/page" '
  /GUARD shell-loaded/ { loads++ }
  loads >= 2 && index($0, want) { seen = 1 }
  END { print seen + 0 }' "$ENGINE_LOG")"
# Whether the first page kept ticking: at least four more ticks after the swap
# than before it, about one second of running.
TICKED=0
if [ -n "$FIRST" ]; then
  AFTER="$(grep -c -F "GUARD tick token=$FIRST " "$ENGINE_LOG" 2>/dev/null || true)"
  [ "${AFTER:-0}" -ge $((${BEFORE:-0} + 4)) ] && TICKED=1
fi

MEASURED="$MODE $ANSWERED $LOADS $TOKENS $SHOWN $TICKED"
echo
echo "measured: $MEASURED"
echo "  (mode answered loads tokens shown-by-the-new-shell ticked-on)"

# Which end to blame. `scripts/test-webview-survives-load-shell-guard.sh` runs
# this block directly. MEASURED is "<mode> <answered> <loads> <tokens>
# <shown> <ticked>".
FAILURE=""
PASSED=""
case "$MEASURED" in
"window 1 2 1 1 1")
  PASSED="a browser window's page outlived the shell that drew it: \
domicile load-shell reloaded the shell, the page was never loaded again, it \
kept running, and the new shell's <webview window> showed it"
  ;;
"own 1 2 2 1 "*)
  PASSED="the control is sharp: the same page in the shell's own \
<webview src> was loaded again by the same reload, with a new token -- so the \
claim's single token is the window's, not a reload that loads nothing"
  ;;
"window 0 "* | "own 0 "*)
  FAILURE="the engine never answered the load_shell with loaded: the \
command socket was not bound (--domicile-command-socket), or the engine \
refused -- the answer is printed above"
  ;;
"window 1 0 "* | "own 1 0 "*)
  FAILURE="the shell page never ran, so nothing here was ever set up: the \
module did not load, or it threw, and the engine log has its console"
  ;;
"window 1 1 "* | "own 1 1 "*)
  FAILURE="the engine said loaded and the shell was not loaded again: \
LoadShellIntoTheShellWindow found the window and the reload never ran it"
  ;;
"window 1 2 0 "* | "own 1 2 0 "*)
  FAILURE="the page never loaded, so there was nothing to survive: in the \
claim, openBrowserWindow opened no window ('opened browser window' in the \
log) or the list never reached the shell; in the control, the <webview src> \
got no guest"
  ;;
"window 1 2 2 "*)
  FAILURE="THE PAGE WAS LOADED AGAIN: the reload took the browser window's \
page with it, or the new shell opened a window of its own. The window has to \
be detached alive when its frame goes (AttachUnownedInnerWebContents) and \
found again by the second shell in the list"
  ;;
"window 1 2 1 0 "*)
  FAILURE="the page survived and the new shell does not show it: the second \
<webview window> was not given the page, or was given it and told nothing \
(AttachToElement, AttachWindowTo, ReportEverything)"
  ;;
"window 1 2 1 1 0")
  FAILURE="the page was not loaded again and stopped running: it outlived \
the shell as an object and not as a page"
  ;;
"own 1 2 1 "*)
  FAILURE="the control's page was not loaded again by the reload, so the \
claim's single token says nothing: a reload that leaves a shell's own \
<webview src> running is not the reload load-shell asks for"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED) -- \
the run did not get as far as reading, or ran a mode this guard does not know"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-webview-survives-load-shell: $FAILURE" "$ENGINE_LOG"
# A crash's bottom forty lines are the message loop, so print what it died of
# first.
echo "what the engine died of, if it did:" >&2
grep -n -A45 -E "FATAL|Check failed|Received signal" "$ENGINE_LOG" | head -150 >&2
echo "the engine's last words:" >&2
tail -40 "$ENGINE_LOG" >&2
exit 1
