#!/usr/bin/env bash
# Asserts the framing guard's fixture serves the pages the guard assumes.
#
# `guard-webview-framing.sh` assumes its page refuses framing. A 404, a wrong
# path or a wrong color would also block the probe, so its negative control
# would pass for the wrong reason. The engine guard cannot tell these apart,
# and running it costs thirty minutes on a shared tree, so the fixture is
# checked here: both framing headers, and the exact color.
#
# The guard's control frames `/permits` and then `/refuses` and attributes the
# difference to the framing headers. So `/permits` must match `/refuses` in
# every other respect: same color, no framing headers.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$ROOT/packages/domicile-engine/scripts/lib-ports.sh"
SERVER="$ROOT/packages/domicile-engine/scripts/guard-webview-framing-server.py"
[ -f "$SERVER" ] || {
  echo "no server at $SERVER" >&2
  exit 1
}

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which is what serves the framing guard's fixture"
  exit 77
}
command -v curl >/dev/null || {
  echo "SKIP: no curl to ask the fixture with"
  exit 77
}

COLOR="D81B60"
# The framer's own background, which tells the probe it measured anything.
# It differs from COLOR so the framer cannot pass by painting the subject's
# color itself.
WITNESS="20304A"

LOG="$(mktemp)"
python3 "$SERVER" --port 0 --color "$COLOR" --witness "$WITNESS" >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  rm -f "$LOG"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  grep -q "serving" "$LOG" 2>/dev/null && break
  sleep 0.25
done
grep -q "serving" "$LOG" 2>/dev/null || {
  echo "the fixture never came up. It said:" >&2
  cat "$LOG" >&2
  exit 1
}
# The server picks a free port and must print it.
PORT="$(served_port "$LOG")" || {
  echo "the fixture never said which port it took. It said:" >&2
  cat "$LOG" >&2
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

# One request for both headers and body, so both assertions see the same
# response.
RESPONSE="$(curl -sS -i "http://127.0.0.1:$PORT/refuses" || echo "curl failed")"

expect "the page is served" "yes" \
  "$(case "$RESPONSE" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
# DENY, not SAMEORIGIN, so the refusal does not depend on which origins serve
# the shell page and the fixture.
expect "X-Frame-Options refuses every ancestor" "yes" \
  "$(case "$RESPONSE" in *[Xx]-[Ff]rame-[Oo]ptions:*DENY*) echo yes ;; *) echo no ;; esac)"
# The CSP frame-ancestors directive is the one that decides: per the spec,
# ancestor_throttle.cc ignores X-Frame-Options when frame-ancestors is present.
expect "CSP forbids all frame-ancestors" "yes" \
  "$(case "$RESPONSE" in *"frame-ancestors 'none'"*) echo yes ;; *) echo no ;; esac)"
# The probe matches this color exactly; any other color fails every positive
# run.
expect "the body is the color the probe looks for" "yes" \
  "$(case "$RESPONSE" in *"#$COLOR"*) echo yes ;; *) echo no ;; esac)"
# Only known paths are served, so a mistyped path in the guard fails.
expect "anything else is a 404" "yes" \
  "$(case "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" in
     404) echo yes ;; *) echo no ;; esac)"

# --- the pages the control is a comparison between ---

# The same page and color without the two headers. It shows that an <iframe>
# in this position can display a page at all.
PERMITS="$(curl -sS -i "http://127.0.0.1:$PORT/permits" || echo "curl failed")"

expect "the framable page is served too" "yes" \
  "$(case "$PERMITS" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
expect "and is the same color as the one that refuses" "yes" \
  "$(case "$PERMITS" in *"#$COLOR"*) echo yes ;; *) echo no ;; esac)"
# A framing header on `/permits` would make it fail for the same reason as
# `/refuses`, and the comparison would prove nothing.
expect "and carries no X-Frame-Options" "yes" \
  "$(case "$PERMITS" in *[Xx]-[Ff]rame-[Oo]ptions:*) echo no ;; *) echo yes ;; esac)"
expect "and no frame-ancestors directive" "yes" \
  "$(case "$PERMITS" in *"frame-ancestors"*) echo no ;; *) echo yes ;; esac)"

# The framing page: an ordinary http document, so the frame has an ancestor
# for the headers to check. The guard's domicile:// shell page cannot frame
# it, because an <iframe> in a domicile:// document does not load http pages.
FRAMES="$(curl -sS -i "http://127.0.0.1:$PORT/frames?src=/permits" || echo "curl failed")"

expect "the framing page is served" "yes" \
  "$(case "$FRAMES" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
expect "and frames what it was asked to" "yes" \
  "$(case "$FRAMES" in *"<iframe"*"src=\"/permits\""*) echo yes ;; *) echo no ;; esac)"
# If neither color appears, the witness shows whether the browser drew
# anything.
expect "and paints the witness around it" "yes" \
  "$(case "$FRAMES" in *"#$WITNESS"*) echo yes ;; *) echo no ;; esac)"
# With nothing to frame, the page would render an empty box, the same as a
# refused frame. It must return an error instead.
expect "a framing page with nothing to frame is refused" "yes" \
  "$(case "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/frames")" in
     400) echo yes ;; *) echo no ;; esac)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the framing guard's fixture refuses framing, twice over, in the right color"
  exit 0
fi
echo "$FAILED assertion(s) wrong" >&2
exit 1
