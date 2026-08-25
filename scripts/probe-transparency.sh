#!/usr/bin/env bash
# Does the engine commit real transparency?
#
#   nix develop .#full -c ./scripts/probe-transparency.sh
#
# The whole hole-punching design in docs/architecture/WINDOW-COMPOSITING.md
# rests on one assumption: that when the chrome asks for a transparent window,
# the engine hands the compositor a buffer with genuine alpha rather than
# black. Every other symptom of the two is identical — a window appears, it has
# the right size, it updates — and only the pixels tell them apart. So this
# asks before anything is built on the answer.
#
# It runs Electron as a Wayland *client of Domicile* rather than of the host,
# which is the relationship the design needs anyway, and which is why this
# needs no display of its own: Domicile accepts the buffer and never presents
# it. The probe reads the alpha channel of the latest frame to arrive — a
# window maps and commits before its page has painted, so the first frame is
# reliably empty and reading that reports every chrome as fully transparent.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

export XDG_RUNTIME_DIR="/tmp/domicile-rt-alpha"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
PROBE="$(mktemp)"; COMPLOG="$(mktemp)"; APPLOG="$(mktemp)"
APPDIR="$(mktemp -d)"
PROBEPID=""; APP=""

RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" "$BIN" --no-shell --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" $PROBEPID $APP 2>/dev/null; rm -rf "$PROBE" "$COMPLOG" "$APPLOG" "$APPDIR"; }
trap cleanup EXIT
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

# The smallest Electron app that asks for a transparent window. Deliberately
# not the real shell: this is about what the engine commits, and the shell's
# own styling would only make the answer harder to read.
cat >"$APPDIR/package.json" <<'JSON'
{ "name": "domicile-alpha-probe", "version": "0.0.0", "main": "main.js" }
JSON
cat >"$APPDIR/main.js" <<'JS'
const { app, BrowserWindow } = require("electron");
// Hardware acceleration is deliberately *left on*. An earlier draft disabled
// it for a steadier alpha reading and then reported the shm buffer that
// caused as though it were Chromium's own choice — the probe answered a
// question it had itself decided.
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 200,
    height: 200,
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
  });
  // Half opaque, half clear — the shape a chrome actually has. An entirely
  // transparent window would only prove the engine can skip painting; what
  // hole-punching needs is that the two coexist in one buffer, so a panel
  // stays solid while the region over an app stays see-through.
  win.loadURL(
    "data:text/html," +
      encodeURIComponent(
        "<html><body style='margin:0;background:transparent'>" +
          "<div style='width:200px;height:100px;background:#ff0000'></div>" +
          "</body></html>",
      ),
  );
});
JS

DOMICILE_CHROME_LISTEN_MS=12000 DOMICILE_CHROME_SOCK="$SOCK" \
  bun "$ROOT/packages/e2e-harness/src/alpha-probe.ts" >"$PROBE" 2>&1 &
PROBEPID=$!
for _ in $(seq 1 200); do plain | grep -aq "chrome client connected" && break; sleep 0.05; done

echo "== running a transparent window as a Wayland client of Domicile =="
WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
  electron --no-sandbox --ozone-platform=wayland --enable-features=UseOzonePlatform \
  "$APPDIR" >"$APPLOG" 2>&1 &
APP=$!

# The probe reports once, when its listen window closes — it needs to see the
# page paint, not just the window map.
for _ in $(seq 1 400); do grep -aq "^alpha" "$PROBE" && break; sleep 0.1; done

if ! plain | grep -aq "toplevel mapped"; then
  echo "FAIL: the engine never mapped a Wayland toplevel on Domicile's socket."
  echo "  Without this the design's premise — the engine as our client — does not hold."
  echo "  --- what it said:"
  cut -c1-200 "$APPLOG" | tail -12 | sed 's/^/  /'
  exit 1
fi
echo "PASS: the engine connected to Domicile and mapped a toplevel"

echo "== the alpha channel of its latest frame =="
cat "$PROBE"
LINE=$(grep -a "^alpha " "$PROBE" | head -1)
if [ -z "$LINE" ]; then
  echo "FAIL: the engine mapped a window but committed no frame the chrome could read."
  plain | grep -aE "WARN|ERROR|broadcast app frame|buffer released" | cut -c1-200 | tail -8 | sed 's/^/  /'
  exit 1
fi

MIN=$(sed 's/.*min=//; s/ .*//' <<<"$LINE")
MAX=$(sed 's/.*max=//; s/ .*//' <<<"$LINE")
CLEAR=$(sed 's/.*clear=//; s/ .*//' <<<"$LINE")
if [ "$MIN" -ne 0 ]; then
  echo "FAIL: no pixel is fully clear — the engine committed no transparency."
  echo "  Hole-punching cannot work through this buffer: there is no hole."
  echo "  See the 'Open questions' in docs/architecture/WINDOW-COMPOSITING.md."
  exit 1
fi
if [ "$MAX" -ne 255 ]; then
  echo "FAIL: no pixel is fully opaque — the whole buffer is see-through."
  echo "  The page painted a solid red band; a buffer with no opaque pixel in it"
  echo "  means the engine dropped the chrome's own content, not just its"
  echo "  background, and a panel drawn over an app would vanish."
  exit 1
fi
echo "PASS: opaque and clear pixels in one buffer (min=$MIN, max=$MAX, $CLEAR clear)"
echo
echo "So the chrome's own content stays solid while the region over an app stays"
echo "see-through — which is exactly what an app composited underneath needs."

# The other half of the question, and the half that needs a GPU. A chrome that
# commits shm still hole-punches correctly — it just costs a readback we would
# rather not pay for a surface that changes as little as the chrome does. Not a
# pass/fail: shm is tolerable, and on a machine with no render node it is the
# only thing on offer.
echo
echo "== how the engine hands its buffer over =="
if ! ls /dev/dri/renderD* >/dev/null 2>&1; then
  echo "UNKNOWN: no DRM render node here, so the engine could only use software."
  echo "  Run this on a machine with a GPU to learn whether it commits dmabufs."
elif plain | grep -aq "client dmabuf accepted"; then
  echo "GPU: the engine committed a dmabuf — its buffer imports with no copy,"
  echo "     which is the same path a Wayland client's frames take."
else
  echo "SHM: a render node is present and hardware acceleration is enabled, and"
  echo "     the engine still committed shared memory. Compositing its surface"
  echo "     costs an upload per frame — bounded by damage, on a surface that"
  echo "     changes as little as a chrome does, so tolerable. What it rules out"
  echo "     is scanning the chrome out directly."
  echo "  --- what the engine said about its GPU, which is where a reason shows:"
  grep -aiE "gpu|gl |egl|dmabuf|software|swiftshader" "$APPLOG" \
    | cut -c1-160 | tail -8 | sed 's/^/  /'
fi
