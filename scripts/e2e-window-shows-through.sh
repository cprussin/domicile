#!/usr/bin/env bash
# Does anything behind a `<domicile-app>` paint over the window?
#
#   nix develop .#full -c ./scripts/e2e-window-shows-through.sh
#
# A background on any element *behind* a `<domicile-app>` composites under the
# window and hides it — every window, if that element spans the desktop, and
# nothing on screen says why. A full-page backdrop written while the bands were
# going in would have done exactly that, and every check in the tree passed on
# it; it was caught by reading, which is not a check. This is the check: the
# compositor reads the texel of the chrome's own committed frame that lies over
# each window and says what it found.
#
# It has to be a real engine. The rule is about a computed background on an
# ancestor, and the test DOM has no cascade — a unit test for it passes
# whatever the page says, which is exactly why the one written at the time was
# deleted rather than shipped. So this runs the shell as a *Wayland client of
# ours*, the same way `e2e-bands.sh` does, with a real client's window on the
# stage under it.
#
# ## Why the client is `--translucent`
#
# The element is only a *hole* where the compositor draws the client's buffer
# itself, and `disposition` does that for a **dmabuf** on a presenting desktop.
# `domicile-test-client` commits `wl_shm`, so this window would be on the **copy
# path** even if this check were given `--present`; the compositor being
# headless here is the smaller half of the reason. On that path the compositor
# reads the client's frame back, sends it, and the shell draws it into a
# `<canvas>` inside the element. What is over the window *is* the window, and it
# is drawn at the alpha the client committed.
#
# `--title` alone gets an `Xrgb8888` window, which is fully opaque, and reading
# that back is indistinguishable from a background painted over it. That is not
# a hypothetical: this check read `alpha=255 opaque=true` and called it a
# hidden window, and passed or failed on whether the chrome frame it happened
# to read predated the shell drawing the canvas. A half-opaque window makes the
# reading say one thing — fully opaque over a window is a background behind the
# element and nothing else.
#
# The compositor reads a texel only for a window it has sent the shell the
# pixels of, and waits out an opaque one, because the shell goes on committing
# frames it rendered before it had the window — the empty stage, whose card
# sits in the middle of exactly where the window is going. The line it prints
# carries the colour as well as the alpha, so a red run says which of those it
# caught: a run against a `#123456` behind the stage read `rgb="#193253"`,
# which is this window composited over it to the byte.
#
# And the alpha asserted below is the client's own, not merely "not opaque". A
# *translucent* background behind the element would composite this window to
# something in between and pass a check that only refused 255 — so the number
# is the one `TRANSLUCENT_ALPHA` draws, and
# `the_grepped_log_messages_are_what_the_scripts_expect` pins the two together.
#
# **To falsify it, put a background on an element** — `main { background: ... }`
# in the shell's `global.css` is the shape the real one had. Not on `html`:
# `electron-chrome-host` injects `html, body { background: transparent
# !important }` into a composited chrome, so an `html` rule never applies and
# is not a defect. A run against one looks like this check failing to fire when
# it should, and it is the check being right.
#
# ## What it catches, and what it still does not — measured, not reasoned
#
# The reading can settle on a frame that has a background painted and the
# window not yet: the compositor cannot tell those apart, because a page it has
# sent a window's pixels to and which has not drawn them looks like a page with
# something in front of it. So the assertion is on the alpha *and the colour*,
# and both come off a real run.
#
# Falsified four ways, one file changed each time and nothing else:
#
#   (none)                                         green: alpha=128 rgb="#101828"
#   main { background-color: #123456 }             red:   alpha=255 rgb="#193253"
#   main { background-color: rgb(18 52 86 / 25%) } red:   alpha=64  rgb="#050d16"
#   main { background-color: rgb(18 52 86 / 50%) } red:   alpha=128 rgb="#091a2b"
#
# Unpremultiply each by the client's alpha and they say what they are.
# `#101828` doubles to `#203050`, which is `COLOURS[0]` — the window itself.
# `#091a2b` doubles to `#123456`, which is the background on its own, from a
# frame before the window was drawn. `#050d16` is the same background at a
# quarter. `#193253` is the window composited over an opaque `#123456`.
#
# The 50% row is why the colour is asserted rather than only the alpha: a
# background at exactly the client's alpha reads `alpha=128 opaque=false` and
# is indistinguishable from the window by the number alone. It passed this
# check until the colour went in.
#
# What is left is narrow and worth naming: a background behind the element that
# is at the client's alpha *and* one of the two colours it draws would still
# read as the window. That is a background painted the same colour as the
# window it is hiding, which is a thing to be told about rather than a thing to
# guard against.
#
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/test-client.sh
. "$ROOT/scripts/lib/test-client.sh"
# 1, not 77. A client this repo builds and cannot build is a broken tree, which
# is a failure; 77 is for what the *machine* is missing.
build_test_client || exit 1
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

if ! command -v electron >/dev/null 2>&1; then
  # Newest by version, not by store hash — see `check.sh`.
  ELECTRON_BIN="$(
    ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
      sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
      sort -V | tail -1 | cut -f2
  )"
  [ -n "$ELECTRON_BIN" ] || {
    echo "SKIP: no electron, and the rule under test is about what a real\n  engine computes for a background."
    exit 77
  }
  PATH="$ELECTRON_BIN:$PATH"; export PATH
fi

export XDG_RUNTIME_DIR="/tmp/domicile-rt-shows"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; ELOG="$(mktemp)"; CLOG="$(mktemp)"
COMP=""; EL=""; APP=""

( cd "$ROOT" && bun run turbo build:vite --filter @domicile/shell-manganese ) >/dev/null 2>&1 \
  || { echo "the shell did not build"; exit 1; }

# NO_COLOR because the fields below are read back out of this log, and tracing
# writes SGR escapes *between* a field name and its value — a pattern for
# `band=0` matches the `0` in an escape sequence first.
NO_COLOR=1 RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
# `kill`, not `kill -9`, for the chrome: Electron is a process tree and a
# SIGKILLed one leaves bash reporting "Killed" on stderr as it reaps it — the
# last line of a run that passed, reading like a failure.
cleanup() { kill "$COMP" "$EL" "$APP" 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$ELOG" "$CLOG"; }
trap cleanup EXIT

# Sourced for all of it, not only the bails: the verdicts below are decisions
# in sequence, every arm ends in a helper that exits or in `passed`, and
# `every_check_ran` catches a bail that turned into a no-op. See
# `packages/e2e-harness/src/verdicts.ts`.
. "$ROOT/scripts/lib/harness.sh"

# Wait until $2 appears in file $1. $3 = max 0.2s ticks.
wait_for() { local file="$1" pat="$2" n="${3:-150}"; for _ in $(seq 1 "$n"); do grep -q "$pat" "$file" && return 0; sleep 0.2; done; return 1; }

for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ] && break; sleep 0.05; done

# Which display the chrome connects on is the compositor's to say: a client on
# the app socket is an app, and the socket is what tells them apart.
for _ in $(seq 1 100); do grep -q "the chrome connects here" "$LOG" && break; sleep 0.05; done
CHROME_DISPLAY="$(sed -n 's/.*the chrome connects here.*display="\([^"]*\)".*/\1/p' "$LOG" | head -1)"
if [ -z "$CHROME_DISPLAY" ]; then
  harness_fault "$COMP" "the compositor could name its chrome display" \
    "ERROR: the compositor never said which display the chrome connects on;" \
    "  its log begins:" \
    "$(head -5 "$LOG")"
fi

# The session document, not the socket: `publish()` is the last statement in
# the compositor's `main()`, so the socket exists long before the document and
# a `cat` on the socket's appearance hands the chrome an empty session.
for _ in $(seq 1 400); do [ -s "$SOCK.session" ] && break; sleep 0.05; done
if [ ! -s "$SOCK.session" ]; then
  harness_fault "$COMP" "the compositor could publish a session" \
    "ERROR: the compositor never published a session, so nothing can be" \
    "  started against it."
fi
# `composited` overridden, which is the one thing the published session cannot
# say here: the compositor reports whether *it* got a window (`--present`) and
# this one deliberately has none — but the chrome below is still a Wayland
# client of ours whose surface we composite, so it must be transparent rather
# than paint a background over the apps. Asserted rather than assumed, because
# the substitution depends on the exact spelling `to_string_pretty` produces
# and a serializer change would make it a silent no-op.
COMPOSITED_SESSION="$(sed 's/"composited": false/"composited": true/' "$SOCK.session")"
case "$COMPOSITED_SESSION" in
  *'"composited": true'*) ;;
  *) harness_fault "$COMP" "the session could be marked composited" \
       "ERROR: could not mark the session composited; the document reads:" \
       "$(cat "$SOCK.session")" ;;
esac

WAYLAND_DISPLAY="$CHROME_DISPLAY" \
  DOMICILE_SESSION="$COMPOSITED_SESSION" \
  electron --no-sandbox --ozone-platform=wayland --disable-gpu \
  "$ROOT/packages/shell-manganese/.vite/build/main.js" >"$ELOG" 2>&1 &
EL=$!

if wait_for "$LOG" "the chrome committed a frame" 400; then
  passed "the shell is a Wayland client of ours, committing frames we composite"
else
  compositor_verdict "$COMP" \
    "FAIL: the chrome never committed a frame we could read, so there is no" \
    "  page to read a texel of over a window. Its own output:" \
    "$(tail -12 "$ELOG")"
fi

# A real client on the app socket, which is what the shell mounts a portal for.
# `--trace` so its own view is in the log beside the compositor's when this
# fails for a reason on the client's side. `--translucent` for the reason at
# the top of this file: on the copy path the page paints this window itself,
# and a half-opaque one is what makes *fully* opaque mean a background.
WAYLAND_DISPLAY=wayland-1 timeout 60 "$TEST_CLIENT" --title shows --trace \
  --translucent >"$CLOG" 2>&1 &
APP=$!

if ! after 1; then
  harness_fault "$COMP" "the first check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif ! wait_for "$LOG" '"type":"place_portal"' 300; then
  compositor_verdict "$COMP" \
    "FAIL: a real client mapped a window and the shell never placed a portal" \
    "  for it, so the compositor does not know where that window is and has" \
    "  nowhere to look. What the client saw:" \
    "$(tail -8 "$CLOG")" \
    "  what the chrome said:" \
    "$(tail -8 "$ELOG")"
else
  passed "a real client's window is on the stage, placed by the shell"
fi

# What the compositor found over the window. `alpha=128` is the client's own
# half-opaque pixels, drawn in the page and painted over by nothing; anything
# else is something between the window and the screen.
looked() { grep -o "the chrome over a window.*" "$LOG" | tail -1; }
for _ in $(seq 1 200); do [ -n "$(looked)" ] && break; sleep 0.2; done

if ! after 2; then
  harness_fault "$COMP" "the second check reached a verdict" \
    "ERROR: this check's premise is the one above it having held."
elif [ -z "$(looked)" ]; then
  compositor_verdict "$COMP" \
    "FAIL: the compositor never reached a reading over the window, so nothing" \
    "  here says a client's pixels reach the screen. It reads on a whole-page" \
    "  chrome frame — a chrome being asked for bands commits one depth at a" \
    "  time and none of those is the page — and only once the chrome has been" \
    "  sent that window's pixels to draw." \
    "  what the chrome said:" \
    "$(tail -8 "$ELOG")"
elif ! printf '%s' "$(looked)" | grep -q "alpha=128 opaque=false"; then
  compositor_verdict "$COMP" \
    "FAIL: what the chrome paints where the window is, is not the window. It" \
    "  draws at half alpha, so anything else over it — fully opaque, or the" \
    "  window blended with something behind it — is a background on an element" \
    "  behind its <domicile-app>, composited under it. That window is not on" \
    "  screen as itself." \
    "  the reading: $(looked)" \
    "  the colour says which: the window's own is #101828 or #182840."
elif ! printf '%s' "$(looked)" | grep -Eq 'rgb="#101828"|rgb="#182840"'; then
  compositor_verdict "$COMP" \
    "FAIL: the chrome is half-opaque where the window is, but it is not the" \
    "  window: the colour is not one of the two this client draws. A" \
    "  background on an element behind its <domicile-app> reads exactly like" \
    "  this when its own alpha happens to match the window's — the alpha" \
    "  cannot tell them apart and the colour can." \
    "  the reading: $(looked)" \
    "  the window's own is rgb=\"#101828\" or rgb=\"#182840\"."
else
  # With the reading, not just the verdict. A green run is a measurement too,
  # and this is the only place it is visible: the compositor's log is a
  # temporary this script deletes, so a pass that printed nothing left the
  # exact colour and alpha it passed on unrecorded — which is what a later
  # tightening of this assertion has to be written against.
  passed "what the chrome paints where the window is, is the window ($(looked))"
fi

every_check_ran 3
