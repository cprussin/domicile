#!/usr/bin/env bash
# Does the framing guard's fixture actually refuse framing?
#
# `guard-webview-framing.sh` rests on one premise: that the page it serves is a
# page a frame owner cannot show. Its negative control establishes that
# something stops an <iframe> — but a 404, a page served on the wrong path, or
# a body that is not the colour the probe looks for all stop an <iframe> too,
# and every one of them would leave the control green while the positive run's
# claim rested on nothing. The engine guard cannot tell those apart, and it
# costs thirty minutes on a shared tree to ask.
#
# So the fixture is asserted here, where it is free: the headers by name,
# because a page carrying one of them is half a fixture, and the colour,
# because the whole assertion downstream is an exact match on it.
#
# AND THE OTHER TWO PAGES, which are what make the control a control. The
# guard's negative run frames `/permits` and then frames `/refuses`, and reads
# the difference between them as the framing headers -- so it is those two
# being identical in every other respect that the reading rests on, and this is
# where that is checked. A `/permits` that carried a framing header, or that
# was some other colour, would turn "the harness can see a framed page here"
# into a run that proves nothing and cannot say so.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

# Not the guard's own port. This runs on every pull request and the guard runs
# on `crux`; sharing a number would make them unable to overlap for no reason.
PORT="${PORT:-8732}"
COLOUR="D81B60"
# The framer's own background, which is what the probe looks for to know it
# measured anything at all. Not the colour: a page that painted the subject's
# colour itself would answer the question the iframe is there to answer.
WITNESS="20304A"

LOG="$(mktemp)"
python3 "$SERVER" --port "$PORT" --colour "$COLOUR" --witness "$WITNESS" >"$LOG" 2>&1 &
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
  echo "the fixture never came up on port $PORT. It said:" >&2
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

# One request, kept: headers and body both come out of it, and asking twice
# would let the two assertions be about two different answers.
RESPONSE="$(curl -sS -i "http://127.0.0.1:$PORT/refuses" || echo "curl failed")"

expect "the page is served" "yes" \
  "$(case "$RESPONSE" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
# DENY, not SAMEORIGIN: the guard's shell page is served from domicile:// and
# the fixture from loopback, but a header that allowed same-origin framing
# would make the refusal depend on where the guard happened to serve things.
expect "X-Frame-Options refuses every ancestor" "yes" \
  "$(case "$RESPONSE" in *[Xx]-[Ff]rame-[Oo]ptions:*DENY*) echo yes ;; *) echo no ;; esac)"
# The second mechanism, and the one that actually decides: ancestor_throttle.cc
# skips X-Frame-Options entirely when the response also carries a
# frame-ancestors directive, which is the spec's precedence rule. A fixture
# with only the header would be refused by the weaker of the two.
expect "CSP forbids all frame-ancestors" "yes" \
  "$(case "$RESPONSE" in *"frame-ancestors 'none'"*) echo yes ;; *) echo no ;; esac)"
# What the probe matches, exactly. A fixture whose body is some other colour is
# a positive run that can never pass.
expect "the body is the colour the probe looks for" "yes" \
  "$(case "$RESPONSE" in *"#$COLOUR"*) echo yes ;; *) echo no ;; esac)"
# One page and no more: a server that answered everything would answer a
# mistyped path too, and the guard would never learn it had mistyped one.
expect "anything else is a 404" "yes" \
  "$(case "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" in
     404) echo yes ;; *) echo no ;; esac)"

# --- the pages the control is a comparison between ---

# The same page, in the same colour, without the two headers. It is the leg
# that establishes an <iframe> in this position can show a page at all, so
# everything the control concludes rests on it being reachable.
PERMITS="$(curl -sS -i "http://127.0.0.1:$PORT/permits" || echo "curl failed")"

expect "the framable page is served too" "yes" \
  "$(case "$PERMITS" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
expect "and is the same colour as the one that refuses" "yes" \
  "$(case "$PERMITS" in *"#$COLOUR"*) echo yes ;; *) echo no ;; esac)"
# THE COMPARISON IS ONLY WORTH ANYTHING IF THIS HOLDS. The control reads the
# difference between the two pages as the framing headers; a `/permits` that
# carried one would be a leg that fails for the reason the other one is
# supposed to.
expect "and carries no X-Frame-Options" "yes" \
  "$(case "$PERMITS" in *[Xx]-[Ff]rame-[Oo]ptions:*) echo no ;; *) echo yes ;; esac)"
expect "and no frame-ancestors directive" "yes" \
  "$(case "$PERMITS" in *"frame-ancestors"*) echo no ;; *) echo yes ;; esac)"

# The page that does the framing: an ordinary http document, so that the frame
# under test has an ancestor a header can be checked against. The guard's own
# shell page cannot be it -- an <iframe> on a domicile:// document does not
# load an http page at all, which is the defect this control was rebuilt for.
FRAMES="$(curl -sS -i "http://127.0.0.1:$PORT/frames?src=/permits" || echo "curl failed")"

expect "the framing page is served" "yes" \
  "$(case "$FRAMES" in *"200 OK"*) echo yes ;; *) echo no ;; esac)"
expect "and frames what it was asked to" "yes" \
  "$(case "$FRAMES" in *"<iframe"*"src=\"/permits\""*) echo yes ;; *) echo no ;; esac)"
# So a run that finds neither colour can say the browser drew nothing, rather
# than reporting an absence it has no standing to report.
expect "and paints the witness around it" "yes" \
  "$(case "$FRAMES" in *"#$WITNESS"*) echo yes ;; *) echo no ;; esac)"
# A framer with nothing to frame would render an empty box, which is exactly
# what a refused frame renders. It must be an error rather than a page.
expect "a framing page with nothing to frame is refused" "yes" \
  "$(case "$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/frames")" in
     400) echo yes ;; *) echo no ;; esac)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "the framing guard's fixture refuses framing, twice over, in the right colour"
  exit 0
fi
echo "$FAILED assertion(s) wrong" >&2
exit 1
