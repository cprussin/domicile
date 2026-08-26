#!/usr/bin/env bash
# Does a client's alpha reach the chrome as the page can draw it?
#
#   nix develop .#full -c ./scripts/e2e-window-alpha.sh
#
# A Wayland client commits *premultiplied* alpha; canvas `ImageData` is defined
# as *straight* alpha and multiplies by alpha again. Left alone that makes every
# translucent pixel of every window composite too dark, and the failure is
# quiet: fully opaque and fully transparent pixels are unaffected, so a
# transparent window is the right *shape* and only its anti-aliased edges and
# its translucency are wrong.
#
# The conversion has unit tests. What those cannot say is whether it is wired
# into the path a live client actually takes — which is `shm` or `dmabuf`
# depending on the machine, and neither is reachable from a unit test. So this
# runs a real client that paints one known colour at one known alpha, and reads
# what a chrome would have been handed.
#
# Which path that is depends on the machine. Where there is no DRM render node
# — this container, and CI — the engine commits `shm`, so that is the wiring
# this covers; the dmabuf side is pinned by the `#[ignore]`d readback tests
# that `scripts/e2e-compose.sh` runs against a software GLES stack.
#
# Half-opaque red is the reading that separates the two answers:
#
#   premultiplied (wrong)  [128, 0, 0, 128]   a half-bright red
#   straight      (right)  [255, 0, 0, 128]   a full red at half alpha
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }
command -v electron >/dev/null 2>&1 || {
  # 77, not 0. `check.sh` has no special case for this script, so an `exit 0`
  # here is indistinguishable from a run that happened and passed — a skipped
  # check reporting green under `DOMICILE_CHECK_STRICT=1`, which is the one
  # thing the strict mode exists to prevent.
  echo "SKIP: no electron to run a translucent client with"; exit 77; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-straight"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
PROBE="$(mktemp)"; COMPLOG="$(mktemp)"; APPLOG="$(mktemp)"
APPDIR="$(mktemp -d)"
PROBEPID=""; APP=""

RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" $PROBEPID $APP 2>/dev/null; rm -rf "$PROBE" "$COMPLOG" "$APPLOG" "$APPDIR"; }
trap cleanup EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

# The smallest client that commits a known translucent colour. Not the real
# shell: this is about what one flat colour becomes, and anything else in the
# buffer only makes the reading harder to trust.
cat >"$APPDIR/package.json" <<'JSON'
{ "name": "domicile-straight-alpha-probe", "version": "0.0.0", "main": "main.js" }
JSON
cat >"$APPDIR/main.js" <<'JS'
const { app, BrowserWindow } = require("electron");
// Acceleration left on, so whichever buffer path this machine actually takes
// is the one under test. A probe that forced shm would answer a question it
// had itself decided.
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 200,
    height: 200,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
  });
  // A flat half-opaque red across the whole window. Every translucent pixel
  // should therefore carry the same red, which is what lets the probe report a
  // range and the script insist the range is a point.
  win.loadURL(
    "data:text/html," +
      encodeURIComponent(
        "<html><body style='margin:0;background:rgba(255,0,0,0.5)'>" +
          "<div style='width:200px;height:200px'></div></body></html>",
      ),
  );
});
JS

DOMICILE_CHROME_LISTEN_MS=12000 DOMICILE_CHROME_SOCK="$SOCK" \
  bun "$ROOT/packages/e2e-harness/src/straight-alpha-probe.ts" >"$PROBE" 2>&1 &
PROBEPID=$!
for _ in $(seq 1 200); do plain | grep -aq "chrome client connected" && break; sleep 0.05; done

echo "== running a half-transparent window as a Wayland client of Domicile =="
WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  electron --no-sandbox --ozone-platform=wayland --enable-features=UseOzonePlatform \
  "$APPDIR" >"$APPLOG" 2>&1 &
APP=$!

for _ in $(seq 1 400); do grep -aq "^red" "$PROBE" && break; sleep 0.1; done

if ! plain | grep -aq "toplevel mapped"; then
  echo "FAIL: the client never mapped a Wayland toplevel."
  cut -c1-200 "$APPLOG" | tail -12 | sed 's/^/  /'
  exit 1
fi

LINE=$(grep -a "^red " "$PROBE" | head -1)
if [ -z "$LINE" ]; then
  echo "FAIL: no frame with half-transparent pixels reached the chrome."
  echo "  Either the client committed nothing, or its window was fully opaque"
  echo "  or fully clear — in which case this checks nothing and must not pass."
  cat "$PROBE" | sed 's/^/  /'
  plain | grep -aE "WARN|ERROR|broadcast app frame" | cut -c1-200 | tail -8 | sed 's/^/  /'
  exit 1
fi
echo "read back: $LINE"

MATCHED=$(sed 's/.*matched=//; s/ .*//' <<<"$LINE")
# The client fills a 200x200 window, so nearly every pixel should be in the
# band. Reported but unchecked, a future client that only anti-aliased a border
# would pass this on a dozen edge pixels that happened to be red.
if [ "$MATCHED" -lt 30000 ]; then
  echo "FAIL: only $MATCHED pixels were half-transparent, out of 40000."
  echo "  The client did not commit the flat translucent fill this reads, so"
  echo "  whatever it did measure is not what this checks."
  exit 1
fi

MIN=$(sed 's/.*min=//; s/ .*//' <<<"$LINE")
MAX=$(sed 's/.*max=//; s/ .*//' <<<"$LINE")
# A band rather than exactly 255: the client asks for 0.5 and an engine rounds,
# so the premultiplied byte can be 127 or 128 and dividing it back out lands
# within a couple of counts of full red. What this has to separate is 255 from
# 128, and anything above 240 is unambiguously the first.
if [ "$MIN" -lt 240 ]; then
  echo "FAIL: the red channel came through at $MIN-$MAX, not near 255."
  echo "  That is premultiplied alpha reaching the page: a half-bright red"
  echo "  rather than a full red at half alpha. Over a light background the"
  echo "  window composites (191,127,127) where it should be (255,127,127)."
  exit 1
fi
echo "PASS: half-transparent pixels carry full red ($MIN-$MAX) — straight alpha"
