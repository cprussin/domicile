#!/usr/bin/env bash
# Does a two-display config actually become two wl_outputs?
#
#   nix develop .#full -c ./scripts/e2e-two-displays.sh
#
# Every half of this is unit-tested — the config normalises the positions, and
# `Screens` decides what to advertise — and none of it says a compositor
# *started on a two-display config* advertises two outputs to a real Wayland
# client. Swapping `Screens::described` for `following_the_window`, which
# disables the whole feature, passes every other check in this suite.
#
# The second half is what a client is told it is *on*, which the globals cannot
# answer: a compositor that advertises two outputs and then enters a window
# onto only the first passes every other check in this suite, and a toolkit
# that scales its content picks the wrong density on the second screen.
#
# Needs no chrome and no display.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
command -v wayland-info >/dev/null 2>&1 || {
  echo "SKIP: wayland-info is what asks the compositor what it advertises."
  exit 77
}
command -v weston-terminal >/dev/null 2>&1 || {
  echo "SKIP: weston-terminal is the real client whose surface has to enter both."
  exit 77
}
# Both `77`s are this script's own, which is the convention: a script that
# needs a client says so itself rather than having `check.sh` keep a list.

export XDG_RUNTIME_DIR="/tmp/domicile-rt-two-displays"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
OUT="$(mktemp)"; CONF="$(mktemp)"; CLIENT="$(mktemp)"; CHROME="$(mktemp)"
AFTER="$(mktemp)"; NESTED="$(mktemp)"; NESTED_CONF="$(mktemp)"; COMPLOG="$(mktemp)"
COMP=""; APP=""; MOCK=""; NCOMP=""

# The left display at the origin and the right one beside it, at twice the
# density. Every field has to survive: the position is where the display sits
# on the desktop, the size is what a client that fills the screen gets, and the
# scale is what it draws at.
cat >"$CONF" <<'TOML'
[[output.displays]]
name = "left"
size = [1920, 1080]

[[output.displays]]
name = "right"
position = [1920, 0]
size = [2560, 1440]
scale = 2
TOML

SOCK="$XDG_RUNTIME_DIR/c.sock"
# The compositor's log is read in phase 3, which is the only place this script
# needs positive evidence that something reached the compositor at all.
RUST_LOG="info,domicile_compositor=debug" \
  "$BIN" --no-shell --config "$CONF" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
# `wait` after the kill so bash reaps the jobs quietly; without it it reports
# "Killed" on stderr at exit, which reads like a failure in a passing run. Not
# a guarantee: a job killed while bash is already past its own reaping still
# leaks the line, and phase 4's compositor does so fairly often.
cleanup() {
  kill -9 "$COMP" "$APP" "$MOCK" "$NCOMP" 2>/dev/null; wait 2>/dev/null
  rm -f "$OUT" "$CONF" "$CLIENT" "$CHROME" "$AFTER" "$NESTED" "$NESTED_CONF" "$COMPLOG"
}
trap cleanup EXIT

# Verdict machinery, shared so that a test can drive it — see
# `packages/e2e-harness/src/verdicts.test.ts`.
. "$ROOT/scripts/lib/harness.sh"

# The compositor colours its log; this dump reads it as plain text. Spelled
# here rather than in the sourced lib, alongside the four other scripts that
# each spell their own: the lib is what `verdicts.test.ts` drives, and one
# untested copy in it is a fifth copy with a different signature.
plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

for _ in $(seq 1 200); do
  [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
  sleep 0.05
done

# One awk over `wayland-info -i wl_output`, so every phase reads it the same way.
#
# The whole `flags` list is in the line, not just its first word. Both halves
# are client-visible and each is dropped by its own one-line mutation:
# `set_preferred` alone leaves every client bound to an output that has told it
# nothing to draw at, which is the "blocks until told" failure this script
# exists for; `change_current_state` alone leaves a toolkit choosing a mode
# with nothing marked preferred. Without the flags they look identical to a
# correct advertisement.
describe_outputs() {
  WAYLAND_DISPLAY=wayland-1 timeout 20 wayland-info -i wl_output >"$1" 2>&1
  awk '
    /^\tname: /            { name = $2 }
    /^\tx: /               { gsub(/,/, ""); pos = $2 "," $4; scale = $6 }
    /^\t\twidth: /         { gsub(/,/, ""); mode = $2 "x" $5 }
    /^\t\tflags: /         { $1 = ""; sub(/^ /, "");
                             print name "@" pos "@" scale "=" mode "(" $0 ")" }
  ' "$1" | tr '\n' ' ' | sed 's/ $//'
}

echo "== what a client is told the screens are =="
# One line per output: its name, where it sits, its scale, and its mode.
DESCRIBED="$(describe_outputs "$OUT")"
echo "$DESCRIBED"

# Before the verdict: `wayland-info` failing to connect at all would otherwise
# be reported as a compositor that advertised nothing, which is a delivery
# bug's verdict for a harness one.
# The mode is physical pixels, so it is the logical size times the scale — the
# right display is 2560x1440 at scale 2 and so a 5120x2880 mode.
EXPECTED="left@0,0@1=1920x1080(current preferred) right@1920,0@2=5120x2880(current preferred)"
# One decision, not a guard and then a verdict: arms, so the verdict is not
# reachable by falling past the bail above it.
if [ -z "$DESCRIBED" ]; then
  harness_fault "$COMP" "phase 1 could read the outputs" \
    "ERROR: wayland-info reported no outputs at all; its output was:" \
    "$(cat "$OUT")"
elif [ "$DESCRIBED" = "$EXPECTED" ]; then
  passed "both displays are advertised, where and how big they are"
else
  compositor_verdict "$COMP" \
    "FAIL: a client was told '$DESCRIBED'" \
    "  Expected '$EXPECTED'. Each field is one a client acts on: the" \
    "  position places the screen, the scale is what it draws at, and the" \
    "  mode is the logical size in physical pixels."
fi

# Advertising the outputs is not putting a window on them. A toolkit that
# scales its content reads `wl_surface.enter` to decide what density to draw
# at, so a surface entered onto only the first output is drawn for the wrong
# screen — and `wayland-info` cannot see this: it binds the globals and maps no
# toplevel. WAYLAND_DEBUG makes the client log the events it receives; object
# names are `wl_surface@12` on current libwayland and `wl_surface#12` on older
# releases, and NO_COLOR stops libwayland writing SGR escapes into the middle
# of them.
echo
echo "== the outputs the client's own surface entered =="
# The client outlives the poll budget — 20s against 6s — so a slow machine
# fails on what the client was told rather than on the client being killed
# mid-answer, which reads like a compositor that advertised one output.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 20 weston-terminal >"$CLIENT" 2>&1 &
APP=$!
for _ in $(seq 1 60); do
  [ "$(grep -cE "wl_surface[#@][0-9]+\.enter\(" "$CLIENT")" -ge 2 ] && break
  sleep 0.1
done
grep -oE "wl_surface[#@][0-9]+\.enter\([^)]*\)" "$CLIENT" | head
# Distinct outputs, not two events: entering the same one twice is not two
# screens, and counting alone cannot tell them apart.
ENTERED="$(grep -oE "wl_surface[#@][0-9]+\.enter\(wl_output[#@][0-9]+\)" "$CLIENT" \
  | sed 's/.*(//' | sort -u | wc -l)"

# Phase 1's guard, for phase 2: a client that never bound an output at all —
# because it could not connect, or because its dependencies are missing —
# entered nothing, and reporting that as "the window entered 0 of 2 outputs" is
# a delivery bug's verdict for a harness one. A compositor that *died* is
# neither: `harness_fault` checks that first, because it is the loudest
# possible verdict on the compositor.
if ! after 1; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif ! grep -qE "wl_registry[#@][0-9]+\.global\([0-9]+, \"wl_output\"" "$CLIENT"; then
  harness_fault "$COMP" "phase 2's client could bind an output" \
    "ERROR: the client never saw a wl_output global; its log begins:" \
    "$(head -5 "$CLIENT")"
elif [ "$ENTERED" -ge 2 ]; then
  passed "the window entered both outputs, not just the first"
else
  compositor_verdict "$COMP" \
    "FAIL: the window entered $ENTERED output(s), and there are two" \
    "  A surface entered onto one of two screens is a window the client" \
    "  draws for the wrong density, and nothing in the globals says so."
fi

# Phase 3: a chrome reporting its own density must not touch a described
# desktop. `set_output_scale` and `adopt_window_scale` both redefine
# `self.screens` from one number, which is right when the window *is* the
# desktop and wrong when the config said what the screens are — so both guard
# on `Screens::follows_the_window`. Nothing else in this suite reaches either
# guard: every other script that starts a chrome runs on the no-displays path,
# where the guard is a no-op by construction.
#
# Deleting a guard would leave `self.screens` a single `Advertised` while
# `self.outputs` keeps two Smithay `Output`s with their own modes — a desktop
# and its outputs disagreeing. `set_output`'s own `assert!` catches that first
# now, so the mutation aborts the compositor rather than advertising the wrong
# thing. Either way this phase fails, and it fails as a compositor verdict:
# `harness_fault` re-checks liveness at the instant it fires, so there is no
# window between the check and the bail for the compositor to die in.
#
# `set_output_scale`'s guard is the one this reaches. `adopt_window_scale`'s
# fires on `WinitEvent::Resized`, which needs a winit window, which needs
# `--present` — so deleting *that* guard passes this phase.
# `e2e-chrome-fills-a-window.sh` is what drives it: it runs `--present` under
# an Xvfb and resizes the window with `xdotool`. What is still uncovered is
# this guard's own case, a `--present` run with displays *configured*, where
# the window must not redescribe them.
#
# What this also does not reach: the chrome branch of `new_toplevel` — not just
# its `enter` loop, which is a second copy of the one phase 2 covers, but also
# the line that sizes the chrome's surface to `screens.size()`, which is the
# only place a described desktop's bounding box becomes a surface size and is
# a second copy of nothing. `mock-chrome.ts` speaks the chrome protocol over a
# socket and maps no Wayland surface, so nothing here makes the compositor give
# a chrome toplevel anything.
# Covering it wants a real chrome with a real surface — Electron — which is
# `e2e-electron`'s dependency and not this script's.
echo
echo "== the screens after a chrome reports a 2x display =="
DOMICILE_CHROME_LISTEN_MS=20000 DOMICILE_CHROME_SOCK="$SOCK" DOMICILE_CHROME_DPR=2 \
  bun "$ROOT/packages/e2e-harness/src/mock-chrome.ts" >"$CHROME" 2>&1 &
MOCK=$!
# Until the chrome has said hello and had its density acted on. The handshake
# is what carries the ratio, so a fixed sleep would race it on a slow machine.
for _ in $(seq 1 200); do
  grep -q '"type":"welcome"' "$CHROME" && break
  sleep 0.05
done

# Before anything is read off the compositor: a chrome that never connected —
# a missing dependency, a protocol version the harness has outrun — leaves the
# screens untouched for the most boring reason there is, and this phase would
# report that as the guard working. The whole phase is a no-op without it.
# One decision, and every arm of it ends in a helper that exits or in the pass.
# Three separate `if`s was the shape this had, and it was a guard-then-verdict
# again: with both bails no-op'd, control walked into the screens check, found
# them unchanged *because nothing ever touched them*, and printed the pass for
# a run in which no chrome connected. "The whole phase is a no-op without it"
# was true, and the phase said PASS anyway.
#
# Read before the chain rather than inside it, the way `e2e-hidpi.sh` reads its
# sizes: a wait and two greps are not decisions and must not sit between arms.
for _ in $(seq 1 200); do
  grep -q "a described desktop keeps its own scale" "$COMPLOG" && break
  sleep 0.05
done
AFTERWARDS="$(describe_outputs "$AFTER")"
echo "$AFTERWARDS"

if ! after 2; then
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif ! grep -q '"type":"welcome"' "$CHROME"; then
  # A chrome that never connected — a missing dependency, a protocol version
  # the harness has outrun — leaves the screens untouched for the most boring
  # reason there is, and everything below would read that as the guard working.
  harness_fault "$COMP" "the mock chrome could complete its handshake" \
    "ERROR: the mock chrome never completed the handshake; its output was:" \
    "$(cat "$CHROME")"
elif grep -q "unparseable chrome message" "$COMPLOG"; then
  # A frame is logged when it arrives and parsed after, so the frame being in
  # the log says a message came, not that this compositor understood it. The
  # protocol moving under the harness looks exactly like a guard that did not
  # fire.
  harness_fault "$COMP" "the compositor could read what the chrome sent" \
    "ERROR: the compositor could not parse a message from the chrome." \
    "  The harness and the host disagree about the wire; nothing here is" \
    "  about the density guard." \
    "$(plain | grep -m1 "unparseable chrome message" | sed 's/^/  /')"
elif ! grep -q "set_device_pixel_ratio" "$COMPLOG"; then
  # `mock-chrome.ts` sends a density only when `DOMICILE_CHROME_DPR` is set, so
  # a name this script spelled wrong leaves it unset with no complaint from
  # anyone, and a welcome does not establish otherwise.
  harness_fault "$COMP" "the chrome could report a density" \
    "ERROR: the chrome never sent a density for the guard to refuse." \
    "  DOMICILE_CHROME_DPR reached mock-chrome.ts unset or misspelled, or" \
    "  the message is still in flight past the 10s this waited." \
    "  The compositor logged no set_device_pixel_ratio from it."
elif [ -z "$AFTERWARDS" ]; then
  harness_fault "$COMP" "phase 3 could re-read the outputs" \
    "ERROR: wayland-info reported no outputs in phase 3; its output was:" \
    "$(cat "$AFTER")"
elif ! grep -q "a described desktop keeps its own scale" "$COMPLOG"; then
  # The compositor's own word that it saw the density and refused it, and the
  # only trace the guarded return leaves. Through the helper that asks whether
  # it is still alive, because the mutant this phase exists to catch aborts the
  # process, and "it never logged the refusal" is a poor way to say "it is not
  # running".
  compositor_verdict "$COMP" \
    "FAIL: the compositor never reported refusing the chrome's density." \
    "  A set_device_pixel_ratio it could parse is in the log, so the guarded" \
    "  return in set_output_scale is what did not happen." \
    "$(plain | tail -5 | sed 's/^/  /')"
elif [ "$AFTERWARDS" = "$EXPECTED" ]; then
  passed "a described desktop is the config's, not the chrome's to redefine"
else
  compositor_verdict "$COMP" \
    "FAIL: the screens became '$AFTERWARDS'" \
    "  Expected them unchanged at '$EXPECTED'. A configured desktop is a" \
    "  fact about the user's screens; a chrome reporting its own density" \
    "  describes the page it is drawing, not the monitors it is drawn on."
fi

# Phase 4: the other half of the same decision — what a run with *no* described
# displays advertises. `compositor.nested_size` is config the compositor never
# read until this change; it replaces a hardcoded constant whose value was the
# same as that setting's default, so `Screens::nested(config.compositor
# .nested_size)` and `Screens::nested((1280, 800))` are indistinguishable on
# every check in this repo unless something states a different size.
#
# A second compositor rather than a second config on the first: `--config` is
# read once at startup, which is the whole reason the desktop is static.
echo
echo "== what a client is told when nothing described a desktop =="
cat >"$NESTED_CONF" <<'TOML'
[compositor]
nested_size = [1600, 900]
TOML
export XDG_RUNTIME_DIR="/tmp/domicile-rt-two-displays-nested"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-*
"$BIN" --no-shell --config "$NESTED_CONF" --chrome-socket "$XDG_RUNTIME_DIR/c.sock" >/dev/null 2>&1 &
NCOMP=$!
for _ in $(seq 1 200); do
  [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break
  sleep 0.05
done

UNDESCRIBED="$(describe_outputs "$NESTED")"
echo "$UNDESCRIBED"

# Scale 1 because no window and no chrome have said otherwise, and the name is
# the one every client that has only ever seen one output has already seen —
# renaming it would move every such client to a screen it thinks is new.
NESTED_EXPECTED="domicile-0@0,0@1=1600x900(current preferred)"
if ! after 3; then
  # `$COMP`, not `$NCOMP`: the checks this premise is about are phases 1-3, and
  # they are the first compositor's. A bookkeeping failure here is not about
  # the one this phase started.
  harness_fault "$COMP" "the checks before this one reached a verdict" \
    "ERROR: a check before this one did not reach a verdict, so nothing" \
    "  below it is a statement about the compositor."
elif [ -z "$UNDESCRIBED" ]; then
  harness_fault "$NCOMP" "phase 4 could read the outputs" \
    "ERROR: wayland-info reported no outputs in phase 4; its output was:" \
    "$(cat "$NESTED")"
elif [ "$UNDESCRIBED" = "$NESTED_EXPECTED" ]; then
  passed "an undescribed desktop is compositor.nested_size, not a constant"
else
  compositor_verdict "$NCOMP" \
    "FAIL: a client was told '$UNDESCRIBED'" \
    "  Expected '$NESTED_EXPECTED'. With no [[output.displays]] the desktop" \
    "  is what compositor.nested_size says; a compositor still using the old" \
    "  hardcoded size looks identical at the default and wrong at every" \
    "  other value."
fi

every_check_ran 4
