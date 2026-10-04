#!/usr/bin/env bash
# Checks a passing `guard-client-window.sh` run prints no false errors.
#
# Error-like lines in a green run mislead whoever reads the log when the guard
# fails for another reason. Two are guarded against:
#
#   ERROR domicile_compositor: nothing has connected to the control socket at
#   …/domicile-client-window.sock after 30s
#
# The compositor's page watchdog (`domicile_launch::handshake`). The guard has
# no shell: chrome gets `--domicile-broker-socket` but no
# `--domicile-control-socket`, so no page can connect. The compositor must be
# told so with `--expect-a-page no`.
#
#   CONSOLE: "domicile: nothing embedded \"app-1\" within 20000ms."
#
# From `spike-page.html`. The page cannot know when the guard starts its
# client, so it must not use a timer. It logs what it is waiting for instead.
#
# Reads the real files, not copies.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-client-window.sh"
PAGE="$SCRIPTS/spike-page.html"
ARGUMENTS="$ROOT/packages/domicile-launch/src/arguments.rs"

# Check the files exist first; a grep on a missing file can look like a pass.
for file in "$GUARD" "$PAGE" "$ARGUMENTS"; do
  [ -f "$file" ] || { echo "no $file" >&2; exit 1; }
done

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# --- the compositor's page watchdog ------------------------------------------

echo "guard-client-window.sh:"

# Slice out the two command lines so comments in the guard that mention the
# flags do not match.
COMPOSITOR="$(awk '/^  "\$COMPOSITOR" \\$/,/^COMP=\$!$/' "$GUARD")"
CHROME="$(awk '/^"\$OUT\/chrome" \\$/,/^STARTED\+=\(\$!\)$/' "$GUARD")"
[ -n "$COMPOSITOR" ] && [ -n "$CHROME" ] || {
  echo "no command lines in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

# The two command lines must agree. If chrome gets a control socket, turning
# the watchdog off would hide a real failure.
case "$CHROME" in
  (*--domicile-control-socket*)
    case "$COMPOSITOR" in
      (*--expect-a-page*no*)
        fail "the compositor is told what this harness will actually do" \
          "chrome is given a control socket to dial and the compositor is told no page is coming, so the watchdog is switched off over a socket a page is meant to reach" ;;
      (*) ok "chrome dials the control socket, so the watchdog has something to wait for" ;;
    esac ;;
  (*)
    case "$COMPOSITOR" in
      (*--expect-a-page*no*)
        ok "the compositor is told no page is coming, because none is" ;;
      (*)
        fail "the compositor is told no page is coming, because none is" \
          "chrome is started without --domicile-control-socket, so nothing dials the compositor's chrome socket and its 30s watchdog prints an ERROR on every green run" ;;
    esac ;;
esac

# The compositor refuses unknown arguments (`arguments.rs` returns `Unknown`),
# so the flag must exist there.
if grep -q '"--expect-a-page"' "$ARGUMENTS"; then
  ok "and it is a flag the compositor's command line knows"
else
  fail "and it is a flag the compositor's command line knows" \
    "--expect-a-page is not in $ARGUMENTS, and an argument the compositor does not read is one it refuses to start on"
fi

# --- the page's embed deadline -----------------------------------------------

echo "spike-page.html:"

# No timer: the page cannot know when the guard starts its client, so any
# deadline fires on healthy runs.
if grep -q 'setTimeout' "$PAGE"; then
  fail "the page does not count down to a deadline it cannot know" \
    "setTimeout is still here, and when a producer arrives is a fact about the harness rather than about the page"
else
  ok "the page does not count down to a deadline it cannot know"
fi

# A wrong app id waits forever instead of failing. Logging the request makes a
# pending embed visible without a timer.
if grep -q "console.log('domicile: waiting to embed" "$PAGE"; then
  ok "it says what it is waiting for, so an embed that never lands is still legible"
else
  fail "it says what it is waiting for, so an embed that never lands is still legible" \
    "nothing is logged when the embed is asked for, so a pending embed and a page that never ran its script read the same"
fi

# The outcome lines, so a settled embed differs from a pending one.
for answer in "domicile: embedded" "domicile: refused: "; do
  if grep -q "console.log('$answer" "$PAGE"; then
    ok "and it says so when the embed settles: \"$answer\""
  else
    fail "and it says so when the embed settles: \"$answer\"" \
      "nothing logs $answer, so a settled embed is indistinguishable from one still waiting"
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
