#!/usr/bin/env bash
# Reproducible end-to-end proof of Domicile's message plane:
#   real Wayland client -> compositor -> Host brain -> chrome
#
#   nix develop .#full -c ./scripts/e2e-chrome.sh
#
# Boots the compositor, connects a headless mock chrome, maps a real toplevel
# (domicile-test-client), and asserts the chrome receives app_appeared.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# 1, not 77. A client this repo builds and cannot build is a broken tree, which
# is a failure; 77 is for what the *machine* is missing, and this needs nothing
# the machine has to supply.
build_test_client || exit 1
BIN="$ROOT/target/debug/domicile-compositor"
# Built here rather than merely checked for. A binary that exists but predates
# the source is the worst of both: every check runs, and every check reports on
# code that is not the code in the tree. Incremental and near-free when there is
# nothing to do.
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-e2e"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/domicile-chrome.sock
SOCK="$XDG_RUNTIME_DIR/domicile-chrome.sock"
OUT="$(mktemp)"
CLIENT="$(mktemp)"

"$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >/dev/null 2>&1 &
COMP=$!
trap 'kill -9 "$COMP" "$MOCK" 2>/dev/null; rm -f "$OUT" "$CLIENT"' EXIT

# Both bails, so that neither kind of failure is reported as the other:
# `harness_fault` re-checks the compositor before blaming this script's own
# machinery, and `compositor_verdict` re-checks it before naming a check as the
# thing that failed. See `packages/e2e-harness/src/verdicts.test.ts`.
#
# Not the counting discipline that goes with them. `every_check_ran` exists
# because a bail that turns into a no-op leaves its decision undecided, and the
# count is what turns the resulting silence into a failure — this script has no
# `passed` calls and no count, so its checks are sequential `if`s rather than
# arms of one decision. Every arm here ends in a helper that exits, so nothing
# is undecided today; the note is here because sourcing this file is the signal
# a reader would otherwise take for the whole discipline.
. "$ROOT/scripts/lib/harness.sh"
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

# A window long enough for the whole run, not the 6s default. The waits below
# are bounded rather than guessed now, which makes the schedule after this line
# longer than it used to be: the handshake poll, then the client's own 2s, then
# the announcement poll. Left at the default, the chrome exits on its own timer
# partway through and the run reports a client that was never announced —
# against a compositor that did nothing wrong. The siblings that added waits
# raised this for the same reason.
DOMICILE_CHROME_LISTEN_MS=20000 DOMICILE_CHROME_SOCK="$SOCK" \
  bun "$ROOT/packages/e2e-harness/src/mock-chrome.ts" >"$OUT" 2>&1 &
MOCK=$!
# Wait for the chrome to be connected rather than for long enough that it
# probably is.
#
# Not because a client that maps first is announced to nobody — it is announced
# again: `hello` makes the compositor re-send `app_appeared` for every window
# still open, which is the whole subject of `e2e-late-chrome.sh`. What that
# catch-up cannot reach is a window that is already *gone*, and this client
# lives for `timeout 2`. So a chrome that spends the old fixed guess still
# booting handshakes into an empty desktop, and the check below reports a
# compositor that never forwarded `app_appeared` — against a compositor that
# forwarded it to nobody who was there.
#
# Bounded well inside the chrome's listen window, so this cannot outlive the
# process it waits on.
# `displays` rather than `welcome`: the host answers a version it *refuses*
# with a welcome too, so that the chrome can name the two versions that
# disagreed. The desktop rides only with the handshake it accepted, so that is
# the line meaning this connection will be listened to.
for _ in $(seq 1 100); do grep -q '"type":"displays"' "$OUT" && break; sleep 0.05; done
# Through the bail that re-checks the compositor first: a compositor that binds
# both sockets and then dies leaves exactly this silence, and blaming the
# harness for it is the mirror image of the fault this change removes.
if ! grep -q '"type":"displays"' "$OUT"; then
  harness_fault "$COMP" "the mock chrome could complete its handshake" \
    "ERROR: the mock chrome never handshook, so nothing below it was" \
    "  tested; its output was:" \
    "$(cat "$OUT")"
fi
# `--trace` makes the client report the protocol messages it receives, which is
# the only place these are visible — it produces no output of its own. Its own
# report rather than `WAYLAND_DEBUG`: the backend it speaks prints
# `wl_surface@12.enter, (Some(wl_output@7))`, and the greps below want
# libwayland's `wl_surface@12.enter(wl_output@7)`, which is the shape the
# client writes.
WAYLAND_DISPLAY=wayland-1 timeout 2 "$TEST_CLIENT" --title app --trace >"$CLIENT" 2>&1
# The client has exited, which says nothing about the chrome having been told
# about it: the announcement crosses the compositor and a second socket after
# the client is gone. Waiting a fixed moment and then killing the chrome makes
# that a race the reader loses on a slow machine — and it loses it as
# "FAIL: Wayland client -> compositor -> Host -> chrome", which is this
# script's whole subject reported against a chrome that was killed mid-write.
#
# Bounded, so a compositor that genuinely never forwards the announcement
# still reaches that verdict with an empty file rather than hanging here.
for _ in $(seq 1 60); do grep -q '"app_appeared"' "$OUT" && break; sleep 0.05; done
kill -9 "$MOCK" 2>/dev/null

echo "== messages the chrome received =="
cat "$OUT"
if grep -q '"app_appeared"' "$OUT"; then
  echo "PASS: Wayland client -> compositor -> Host -> chrome"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome was never told a client appeared"
fi

# And the name, which is the only coverage `title_changed` has: it needs a real
# client making a real `set_title`, so nothing below the e2e level reaches it.
#
# The premise is still checked rather than assumed, but it is now a harness
# fault rather than a note: this client is ours and always names its window, so
# a run with no `set_title` in its log means the client did not get that far,
# and the `app_titled` assertion below would be holding for the wrong reason.
# It used to be a `NOTE` because weston-flower's naming was its own business.
if ! grep -q 'set_title' "$CLIENT"; then
  harness_fault "$COMP" "the client named its window" \
    "ERROR: the client never sent set_title, so nothing below tests app_titled." \
    "  Its log begins:" \
    "$(head -5 "$CLIENT")"
elif grep -q '"app_titled"' "$OUT"; then
  echo "PASS: the client named its window and the chrome was told"
else
  compositor_verdict "$COMP" \
    "FAIL: the client sent set_title and the chrome was never told the name"
fi

# A client may not touch a buffer again until the compositor releases it, so a
# compositor that never releases stalls any client that reuses one — the window
# freezes after its first frame. Smithay only releases the previous buffer when
# the next one is committed, which is exactly the buffer the client cannot draw.
# A client that scales its content asks which output it is on before it draws
# its first frame — GLFW-based ones (kitty) block on exactly this. A compositor
# that never sends `wl_surface.enter` leaves them mapped and blank forever.
echo "== the client was told which output it is on =="
grep -oE "wl_surface[#@][0-9]+\.enter" "$CLIENT" | head -1
if grep -qE "wl_surface[#@][0-9]+\.enter" "$CLIENT"; then
  echo "PASS: the client got wl_surface.enter"
else
  compositor_verdict "$COMP" \
    "FAIL: no wl_surface.enter — the client never learns its output or scale"
fi

echo "== the client got its buffer back =="
grep -oE "wl_buffer[#@][0-9]+\.release" "$CLIENT" | head -1
if grep -qE "wl_buffer[#@][0-9]+\.release" "$CLIENT"; then
  echo "PASS: the compositor released the client's buffer"
else
  compositor_verdict "$COMP" \
    "FAIL: no wl_buffer.release — the client can never reuse that buffer"
fi
