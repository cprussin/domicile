#!/usr/bin/env bash
# The chrome is told which modifiers are held, and only when that changes.
#
# A page cannot see this for itself. `wl_keyboard.modifiers` goes to the
# surface that holds the keyboard, so the moment a window is focused the chrome
# stops hearing about the Alt the user is holding — which is exactly when a
# shell wants to know, because that is when it would begin an alt-drag. So the
# compositor tells every chrome, and this is what proves it does.
#
# Four things, in one run: a modifier going down is a message; the ordinary
# keys pressed while it is held are not; letting go is a message; and a chrome
# that reloads mid-press is told the modifier it heard go down is no longer
# held. That last one is the failure with no way back — a page still holding an
# Alt nobody is pressing drags the next window the user clicks, for as long as
# it runs.
#
# Nothing here needs a display, a client, or a browser: the keys go in over the
# chrome socket and the verdict comes back out of it.
#
#   nix develop .#full -c ./scripts/e2e-modifiers.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-modifiers"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
OUT="$(mktemp)"

"$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
# `wait` after the kill, or a passing run ends with the shell reporting
# "Killed" on stderr — which reads like a failure in a run that passed.
cleanup() { kill -9 "$COMP" 2>/dev/null; wait 2>/dev/null; rm -f "$OUT"; }
trap cleanup EXIT

# Sourced for all of it, not only the bails: the verdicts below are decisions
# in sequence, every arm ends in a helper that exits or in `passed`, and
# `every_check_ran` catches a bail that turned into a no-op. See
# `packages/e2e-harness/src/verdicts.ts` for why an arm alone is not enough.
. "$ROOT/scripts/lib/harness.sh"
for _ in $(seq 1 200); do [ -S "$SOCK" ] && break; sleep 0.05; done

if ! DOMICILE_CHROME_SOCK="$SOCK" timeout 30 bun "$ROOT/packages/e2e-harness/src/modifiers-probe.ts" >"$OUT" 2>&1; then
  harness_fault "$COMP" "the chrome stand-in could finish its sequence" \
    "ERROR: the chrome stand-in did not finish its sequence, so the keys it" \
    "  was meant to send may never have been sent; its output was:" \
    "$(cat "$OUT")"
fi

echo "== what the chrome was told =="
cat "$OUT"

# Everything the compositor said, in order. That is the whole verdict: which
# messages arrived, how many, and in which sequence.
#
# Not attributed to the key that caused each one, which would be a finer answer
# and a wrong one: a message is written when the compositor's loop reaches it,
# so a check that reads it against the step the probe was sleeping in fails on
# a slow machine rather than on a broken one.
told() {
  grep '^modifiers: ' "$OUT"
}

HELD="modifiers: alt=true ctrl=false shift=false logo=false"
LET_GO="modifiers: alt=false ctrl=false shift=false logo=false"

if [ -z "$(told)" ]; then
  compositor_verdict "$COMP" \
    "FAIL: the chrome was never told anything about the modifiers." \
    "  Alt was held twice and let go twice, and none of it was a message." \
    "  A chrome that is never told cannot answer a held modifier at all."
elif [ "$(told | head -1)" != "$HELD" ]; then
  compositor_verdict "$COMP" \
    "FAIL: the first thing said was not alt being held." \
    "  Expected: $HELD" \
    "  Got: $(told | head -1)"
else
  passed "a modifier going down is a message"
fi

if ! after 1; then
  harness_fault "$COMP" "the first check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif [ "$(told | wc -l)" -ne 4 ]; then
  compositor_verdict "$COMP" \
    "FAIL: the chrome was told $(told | wc -l) times, not 4." \
    "  Four things changed the modifiers — alt down, up, down, and the reload" \
    "  that let go of it — and the Enter pressed in between changed nothing." \
    "  A page told on every keystroke is reading a keystroke counter."
else
  passed "the keys pressed while it is held say nothing"
fi

if ! after 2; then
  harness_fault "$COMP" "the second check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif [ "$(told | sed -n 2p)" != "$LET_GO" ]; then
  compositor_verdict "$COMP" \
    "FAIL: letting go of alt was not reported." \
    "  Expected the second message to be: $LET_GO" \
    "  Got: $(told | sed -n 2p)" \
    "  A page that heard it go down and not come up holds it forever."
else
  passed "letting go is a message too"
fi

if ! after 3; then
  harness_fault "$COMP" "the third check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif [ "$(told | sed -n 3p)" != "$HELD" ]; then
  compositor_verdict "$COMP" \
    "FAIL: the second press of alt was not reported as held." \
    "  Got: $(told | sed -n 3p)" \
    "  Nothing was holding a modifier across the reload, so what the message" \
    "  after it asserts was never set up. Not a pass, and not the reload's" \
    "  failure either."
elif [ "$(told | sed -n 4p)" != "$LET_GO" ]; then
  compositor_verdict "$COMP" \
    "FAIL: a chrome that reloaded holding alt was not told it had been let go." \
    "  Expected the fourth message to be: $LET_GO" \
    "  Got: $(told | sed -n 4p)" \
    "  The seat releases the keys a dead page was holding; a chrome not told" \
    "  drags the next window the user clicks, for as long as it runs."
else
  passed "a reload releases a held modifier, and says so"
fi

every_check_ran 4
