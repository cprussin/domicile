#!/usr/bin/env bash
# Tests the verdict of `guard-webview-active-tab.sh`: which readings pass and
# which component a failure blames.
#
# Runs the verdict block from the real guard. Key cases: a click with no grant
# and a grant with no paint blame different components; in the control, the
# color with no click is the failure.
#
# Also checks what the guard cannot check at runtime: the expected id matches
# the fixture's key, the expected color matches what the fixture paints, and
# the fixture requests activeTab and no host permissions.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-webview-active-tab.sh"
FIXTURE="$SCRIPTS/guard-webview-active-tab-extension"
[ -f "$GUARD" ] || {
  echo "no guard at $GUARD" >&2
  exit 1
}

BLOCK="$(awk '/^FAILURE=""$/,/^esac$/' "$GUARD")"
[ -n "$BLOCK" ] || {
  echo "no verdict block in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

# Prints pass, fail or neither. Sentences are not compared, since they change.
verdict() { # $1 MEASURED
  (
    MEASURED="$1"
    eval "$BLOCK"
    if [ -n "$PASSED" ]; then
      echo "pass"
    elif [ -n "$FAILURE" ]; then
      echo "fail"
    else
      echo "neither"
    fi
  )
}

# Whether the failure message contains `$2`, i.e. blames the right component.
says() { # $1 MEASURED, $2 what the sentence must contain
  case "$(
    MEASURED="$1"
    eval "$BLOCK"
    echo "$FAILURE"
  )" in
  *"$2"*) echo yes ;;
  *) echo no ;;
  esac
}

# MEASURED is "<leg> <probe status> <sent> <tray> <activated> <granted>": probe
# status 0 (color), 1 (witness only) or 2 (neither); whether the stand-in sent
# the list; whether the fixture reached the tray; whether the shell clicked it;
# whether the tray logged the grant.
echo "the claim — a click, and the page painted"
expect "painted after a granted click is the pass" "pass" \
  "$(verdict "painted 0 1 1 1 1")"
expect "painted with no click is a failure" "fail" \
  "$(verdict "painted 0 1 1 0 0")"
expect "a list never sent is a failure" "fail" "$(verdict "painted 1 0 0 0 0")"
expect "and blames the control channel" "yes" \
  "$(says "painted 1 0 0 0 0" "control channel")"
expect "a fixture never in the tray is a failure" "fail" \
  "$(verdict "painted 1 1 0 0 0")"
expect "a shell that never clicked is a failure" "fail" \
  "$(verdict "painted 1 1 1 0 0")"
expect "and says it was never focused" "yes" \
  "$(says "painted 1 1 1 0 0" "focused")"

# The two cases the guard exists for.
expect "a click the tray granted nothing for is a failure" "fail" \
  "$(verdict "painted 1 1 1 1 0")"
expect "and blames the active tab or Activate" "yes" \
  "$(says "painted 1 1 1 1 0" "ExtensionTray::Activate")"
expect "a grant that painted nothing is a failure" "fail" \
  "$(verdict "painted 1 1 1 1 1")"
expect "and blames onClicked or executeScript" "yes" \
  "$(says "painted 1 1 1 1 1" "executeScript")"
expect "a page never drawn is a failure" "fail" "$(verdict "painted 2 1 1 1 1")"

echo
echo "the control — no click, and the page unpainted"
expect "unpainted, installed and unclicked is the pass" "pass" \
  "$(verdict "control 1 1 1 0 0")"
# Inverted: the color is the failure, because it is the claim's reading.
expect "painted with no click is a failure" "fail" \
  "$(verdict "control 0 1 1 0 0")"
expect "and says the claim proves nothing" "yes" \
  "$(says "control 0 1 1 0 0" "proves nothing")"
expect "unpainted with the fixture never installed is a failure" "fail" \
  "$(verdict "control 1 1 0 0 0")"
expect "a control that clicked is a failure" "fail" \
  "$(verdict "control 1 1 1 1 1")"
expect "a page never drawn is a failure, not a pass" "fail" \
  "$(verdict "control 2 1 1 0 0")"

echo
echo "a run that measured nothing at all"
expect "an empty measurement is a failure" "fail" "$(verdict "")"
expect "and so is a leg nobody runs" "fail" "$(verdict "elephant 0 1 1 1 1")"

echo
echo "the fixture"
ID="$(sed -n 's/^readonly ID="\([a-p]\{32\}\)"$/\1/p' "$GUARD")"
KEY="$(sed -n 's/^ *"key": "\([^"]*\)",$/\1/p' "$FIXTURE/manifest.json")"
MADE="$(printf '%s' "$KEY" | base64 -d 2>/dev/null | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')"
COLOR="$(sed -n 's/^readonly COLOR="\([0-9A-F]\{6\}\)"$/\1/p' "$GUARD")"
expect "the guard names an id" "yes" "$([ -n "$ID" ] && echo yes || echo no)"
expect "and it is the one the fixture's key makes" "$ID" "$MADE"
expect "the guard names a color" "yes" "$([ -n "$COLOR" ] && echo yes || echo no)"
expect "and it is the one the fixture paints" "yes" \
  "$(grep -qF "background: #$COLOR !important" "$FIXTURE/background.js" &&
    echo yes || echo no)"
expect "the fixture paints the tab its click names" "yes" \
  "$(grep -qF 'target: { tabId: tab.id }' "$FIXTURE/background.js" &&
    echo yes || echo no)"
expect "and may, by activeTab and nothing else" "yes" \
  "$(grep -qF '"permissions": ["activeTab", "scripting"]' \
    "$FIXTURE/manifest.json" && ! grep -qF 'host_permissions' \
    "$FIXTURE/manifest.json" && echo yes || echo no)"
expect "and has no popup, so the click is its onClicked" "yes" \
  "$(grep -qF 'default_popup' "$FIXTURE/manifest.json" && echo no || echo yes)"

# An event with no listener yet is dropped. The tray row appears at install,
# before the service worker runs, so an early click is granted but never
# dispatched (cprussin/domicile#738). The worker badges its action once
# onClicked is registered, and the shell clicks only a badged row.
SHELL_MODULE="$SCRIPTS/guard-webview-active-tab.js"
LISTENS="$(grep -n 'action.onClicked.addListener' "$FIXTURE/background.js" | cut -d: -f1)"
BADGES="$(grep -n 'action.setBadgeText({ text: "on" })' "$FIXTURE/background.js" | cut -d: -f1)"
expect "the fixture badges its action once onClicked is registered" "yes" \
  "$([ -n "$LISTENS" ] && [ -n "$BADGES" ] && [ "$BADGES" -gt "$LISTENS" ] &&
    echo yes || echo no)"
expect "and the shell counts it in the tray only with that badge" "yes" \
  "$(grep -qF 'extension.badgeText === "on"' "$SHELL_MODULE" &&
    echo yes || echo no)"

# `url` can be a pending entry and `loading` can clear for a load that never
# committed, so the click could land before the page (cprussin/domicile#797).
# The still page commits `#ready` after load, and the shell clicks only once
# its <webview> shows that URL.
SERVER="$SCRIPTS/guard-webview-content-script-server.py"
SERVER_LOG="$(mktemp)"
python3 "$SERVER" --port 0 --color 123456 --still >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
  grep -qF "serving" "$SERVER_LOG" && break
  sleep 0.25
done
PORT="$(sed -n 's/^serving .* on 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$SERVER_LOG")"
STILL="$(curl -sf "http://127.0.0.1:$PORT/page")"
kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null
rm -f "$SERVER_LOG"
expect "the still page says it is up once it has loaded" "yes" \
  "$(case "$STILL" in
    *'addEventListener("load", () => {'*'history.replaceState(null, "", "#ready");'*)
      echo yes
      ;;
    *) echo no ;;
    esac)"
expect "and the shell focuses, so clicks, only a page that said so" "yes" \
  "$(grep -qF 'view.url === `${src}#ready`' "$SHELL_MODULE" &&
    echo yes || echo no)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the webview-active-tab guard's verdict names the right end in every case"
  exit 0
fi
echo "$FAILED case(s) wrong" >&2
exit 1
