#!/usr/bin/env bash
# Does Domicile's own window grow when the desktop it shows does?
#
#   nix develop .#full -c ./scripts/e2e-window-follows-the-desktop.sh
#
# The third of the presented paths, and the one nothing drove. Its siblings
# cover a desktop the config describes (`e2e-chrome-fills-the-desktop.sh`,
# headless) and a desktop that *is* the window (`e2e-chrome-fills-a-window.sh`,
# `--present` with no displays configured). This is both at once: a described
# desktop, shown in a window, and the config changing under it.
#
# `Screens::window_showing_it` computes the window a desktop wants and is used
# at startup. A reload never asked again, so adding a display to the config
# left the wider desktop scaled down into the window it already had —
# `logical_to_window` stretching rather than the window growing, which reads as
# a desktop that suddenly went blurry and small.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=scripts/lib/harness.sh
. "$ROOT/scripts/lib/harness.sh"
# shellcheck source=scripts/xvfb-display.sh
. "$ROOT/scripts/xvfb-display.sh"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

# No electron here: what is under test is the window the compositor asks its
# host for, which it does whether or not a chrome ever connects.
command -v xdotool >/dev/null 2>&1 || {
  echo "SKIP: no xdotool, which is what reads the window's size back off X."
  exit 77
}

export XDG_RUNTIME_DIR="/tmp/domicile-rt-follows"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
LOG="$(mktemp)"; CONF="$XDG_RUNTIME_DIR/domicile.toml"
COMP=""

# A desktop that is no default. Not sized to fit the screen: `ensure_display`
# inherits `$DISPLAY` and its geometry when there is one, and `check.sh` starts
# its Xvfb at 1280x800, so the grown 1500-wide desktop below is wider than the
# screen under the suite. That is fine — X puts no ceiling on a window's size
# at the root's and a bare Xvfb has no WM to clamp it — but it is the reason it
# works, rather than the sizes having been chosen to fit.
#
# `compositor.nested_size` is raised past both, because it is the ceiling on
# what Domicile will ask a host for: at its 1280x800 default the grown desktop
# below does not fit, and `window_showing_it` correctly scales it down to
# 1280x512 instead — a right answer to a different question than this asks.
# The first version of this check read that as the fix having failed.
WIDTH=900
HEIGHT=600
cat >"$CONF" <<TOML
[compositor]
nested_size = [1920, 1080]

[[output.displays]]
name = "only"
size = [$WIDTH, $HEIGHT]
TOML

ensure_display 1920x1080x24 60 || exit 1

# `WINIT_X11_SCALE_FACTOR=1` so the window's device pixels and the desktop's
# logical units are the same number, which is what makes the two comparable at
# all — the same reason `e2e-chrome-fills-a-window.sh` pins it.
NO_COLOR=1 RUST_LOG=info WINIT_X11_SCALE_FACTOR=1 \
  "$BIN" --present --config "$CONF" --chrome-socket "$SOCK" >"$LOG" 2>&1 &
COMP=$!
cleanup() { kill "$COMP" ${XVFB:-} 2>/dev/null; wait 2>/dev/null; rm -f "$LOG" "$CONF"; }
trap cleanup EXIT

for _ in $(seq 1 200); do grep -q "presenting to a window" "$LOG" && break; sleep 0.05; done
for _ in $(seq 1 200); do
  WID="$(xdotool search --name "Domicile" 2>/dev/null | head -1)"
  [ -n "${WID:-}" ] && break
  sleep 0.05
done

# Asked of X each time rather than read once out of the log: the compositor
# names its window's size when it opens it and never again, so a log line
# cannot say whether it grew afterwards — which is the whole question here.
window_now() {
  xdotool getwindowgeometry --shell "$WID" 2>/dev/null |
    sed -n 's/^WIDTH=\([0-9]*\)/\1/p;s/^HEIGHT=\([0-9]*\)/x\1/p' | tr -d '\n'
}

# Whether the compositor's *main thread* survived, which `kill -0` cannot say.
# A panic there unwinds main and leaves winit's and Smithay's own threads
# running, so the process is still alive to signal 0 while the compositor has
# stopped doing anything — and "the window did not change" then reads as it
# having correctly left the window alone. A crash passing as the behaviour
# under test is exactly what this check exists to catch, so it asks the log.
panicked() {
  grep -q "panicked at" "$LOG"
}

echo "== the window the described desktop opened in =="
echo "window: $(window_now)"

if [ -z "${WID:-}" ]; then
  harness_fault "$COMP" "the compositor could open a window at all" \
    "ERROR: no window named Domicile on this display; the compositor's log" \
    "  ends:" \
    "$(tail -5 "$LOG")"
elif [ "$(window_now)" = "${WIDTH}x${HEIGHT}" ]; then
  passed "the window opened at the desktop's own size"
else
  compositor_verdict "$COMP" \
    "FAIL: the desktop is ${WIDTH}x${HEIGHT} and its window is $(window_now)." \
    "  A window that is not the desktop's size shows it scaled, which is" \
    "  what \`window_showing_it\` exists to avoid at startup."
fi

# And when the desktop grows under it. Grown by gaining a display, which is
# what a reload most often is, and by enough that no rounding could account
# for the difference.
GREW_W=1500
GREW_H=600
cat >"$CONF" <<TOML
[compositor]
nested_size = [1920, 1080]

[[output.displays]]
name = "only"
size = [900, 600]

[[output.displays]]
name = "second"
position = [900, 0]
size = [600, 600]
TOML

for _ in $(seq 1 200); do [ "$(window_now)" = "${GREW_W}x${GREW_H}" ] && break; sleep 0.1; done

echo
echo "== after the config gained a second display =="
echo "window: $(window_now)"
grep -E "taking up a reloaded desktop" "$LOG" | tail -1

if ! after 1; then
  harness_fault "$COMP" "the first size could be checked" \
    "ERROR: the size the window opened at was never established."
elif ! grep -q "taking up a reloaded desktop" "$LOG"; then
  harness_fault "$COMP" "the reload could be taken up at all" \
    "ERROR: the compositor never took up the reloaded config, so nothing" \
    "  here is about whether the window would have grown; its log ends:" \
    "$(tail -5 "$LOG")"
elif [ "$(window_now)" = "${GREW_W}x${GREW_H}" ]; then
  passed "the window grew to the desktop's new size"
else
  compositor_verdict "$COMP" \
    "FAIL: the desktop grew to ${GREW_W}x${GREW_H} — the box two displays" \
    "  make up — and its window is still $(window_now)." \
    "  \`Screens::window_showing_it\` computes the window a desktop wants and" \
    "  is asked at startup; a reload that does not ask again leaves the wider" \
    "  desktop scaled into the old window by \`logical_to_window\`, which is a" \
    "  desktop that went blurry and small rather than one that grew."
fi

# And when the config stops describing displays at all. `Screens::reloaded_into`
# hands the desktop back to the window there — it becomes window-following, and
# `adopt_window_scale` is what sizes it from then on — so this is the one
# reload that must *not* ask for a window. Asking anyway snapped the window to
# `compositor.nested_size` for the crime of deleting a display, and asserting
# that it could not happen aborted the compositor instead.
WAS="$(window_now)"
cat >"$CONF" <<TOML
[compositor]
nested_size = [1920, 1080]
TOML

for _ in $(seq 1 40); do
  grep -q "taking up a reloaded desktop displays=1 " "$LOG" && break
  sleep 0.1
done

echo
echo "== after the config stopped describing displays =="
echo "window: $(window_now)"

if ! after 2; then
  harness_fault "$COMP" "the grown size could be checked" \
    "ERROR: the size the window grew to was never established."
elif panicked; then
  compositor_verdict "$COMP" \
    "FAIL: the compositor panicked when the config stopped describing displays:" \
    "$(grep -A 2 'panicked at' "$LOG" | head -3)" \
    "  Handing the desktop back to the window is a supported edit, not a" \
    "  crash: \`Screens::reloaded_into\` has an arm for it and a unit test on" \
    "  that arm."
elif [ "$(window_now)" = "$WAS" ]; then
  passed "the window was left alone when the desktop went back to following it"
else
  compositor_verdict "$COMP" \
    "FAIL: the window was $WAS and is now $(window_now)." \
    "  A desktop that stopped being described follows the window again, so" \
    "  the window is the authority and nothing here should have resized it." \
    "  Snapping it to \`compositor.nested_size\` is the desktop overruling" \
    "  the user for having deleted a display from their config."
fi

every_check_ran 3
