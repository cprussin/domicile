#!/usr/bin/env bash
# The two lines a passing `guard-client-window.sh` run used to print that read
# as the reason it failed.
#
# WHY THIS IS WORTH A CHECK. Both were in the log of the run that took
# `pinned-engine.yml` red on `main`, and neither was the failure. Whoever reads
# a red job log reads what looks like an error first, so a green run that
# carries two of them costs a session every time the guard goes red for an
# unrelated reason — and it went red for an unrelated reason in September 2026,
# twice. A diagnostic that fires when nothing is wrong is not a diagnostic.
#
#   ERROR domicile_compositor: nothing has connected to the control socket at
#   …/domicile-client-window.sock after 30s
#
# is the compositor's page watchdog (`domicile_launch::handshake`), and it was
# right: nothing had. THIS HARNESS HAS NO SHELL. The guard starts chrome with
# `--domicile-broker-socket` and no `--domicile-control-socket`, because what
# it is measuring is a client's window reaching a file:// page through the
# broker, not a desktop. `ControlChannel` is bound for the shell's origin, so
# no page here can dial that socket whatever it is told. The compositor is the
# only end that cannot tell "no page yet" from "no page ever" — so it is told,
# on the command line, and the watchdog is right in both harnesses instead of
# only in the one that has a shell.
#
#   CONSOLE: "domicile: nothing embedded \"app-1\" within 20000ms."
#
# is `spike-page.html`, and the deadline behind it was never knowable from the
# page: a producer for `app-1` exists when the guard starts its client, which
# is after the compositor is up, which is well past any constant the page could
# name. In the red run that line is stamped 20.0s after load and the client was
# not started for another 40. So the page stops guessing at a clock and says
# what it is waiting for instead — which is the whole of what the deadline was
# for, minus the false alarm.
#
# Both halves are read out of the real files. A copy is a thing that passes
# while the thing it stands for does not.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"
GUARD="$SCRIPTS/guard-client-window.sh"
PAGE="$SCRIPTS/spike-page.html"
ARGUMENTS="$ROOT/packages/domicile-launch/src/arguments.rs"

# THE POSITIVE FIRST. Every check below is a grep over a file, and a grep over
# a file that is not there answers the same way as a grep over one that passes.
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

# The compositor's command line, and chrome's, sliced rather than grepped out
# of the whole file: this script explains both flags in prose above, and a
# check that could not tell the explanation from the thing explained would
# forbid the comment that keeps the next person from undoing the change.
COMPOSITOR="$(awk '/^  "\$COMPOSITOR" \\$/,/^COMP=\$!$/' "$GUARD")"
CHROME="$(awk '/^"\$OUT\/chrome" \\$/,/^STARTED\+=\(\$!\)$/' "$GUARD")"
[ -n "$COMPOSITOR" ] && [ -n "$CHROME" ] || {
  echo "no command lines in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}

# THE PAIR, not either half. "Tell the compositor no page is coming" is the
# right answer only while no page is coming; wire a shell into this harness
# later and the same flag turns the watchdog off over a socket a page really
# was meant to dial, which is the failure it exists to catch. So what is
# asserted is that the two agree.
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

# AND THE FLAG HAS TO BE ONE THE COMPOSITOR TAKES. Its command line is refused
# whole — an argument nothing reads is a request that silently did not happen,
# so `arguments.rs` returns `Unknown` rather than ignoring it — which means a
# flag spelled only here does not weaken the guard, it stops it starting at
# all.
if grep -q '"--expect-a-page"' "$ARGUMENTS"; then
  ok "and it is a flag the compositor's command line knows"
else
  fail "and it is a flag the compositor's command line knows" \
    "--expect-a-page is not in $ARGUMENTS, and an argument the compositor does not read is one it refuses to start on"
fi

# --- the page's embed deadline -----------------------------------------------

echo "spike-page.html:"

# A TIMER IS THE THING BEING FORBIDDEN, not a sentence. The page cannot know
# when a producer is due — the guard starts its client after the compositor is
# up — so any constant it counts down to is a line that fires on runs where
# nothing is wrong.
if grep -q 'setTimeout' "$PAGE"; then
  fail "the page does not count down to a deadline it cannot know" \
    "setTimeout is still here, and when a producer arrives is a fact about the harness rather than about the page"
else
  ok "the page does not count down to a deadline it cannot know"
fi

# WHAT THE DEADLINE WAS FOR IS KEPT. "A wrong app id does not fail — the
# browser holds an embed until that app has a producer, so it waits, and a page
# that waits forever looks exactly like a seam that is broken." That reading is
# what the line has to survive without: an embed that is still pending says so
# when it is asked for, and the answer that never comes under it is the same
# finding with no clock in it.
if grep -q "console.log('domicile: waiting to embed" "$PAGE"; then
  ok "it says what it is waiting for, so an embed that never lands is still legible"
else
  fail "it says what it is waiting for, so an embed that never lands is still legible" \
    "nothing is logged when the embed is asked for, so a pending embed and a page that never ran its script read the same"
fi

# And the answers, which are what make the line above mean anything: a log with
# the waiting line and one of these is an embed that settled, and a log with
# the waiting line alone is one that did not.
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
