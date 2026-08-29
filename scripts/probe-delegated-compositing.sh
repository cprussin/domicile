#!/usr/bin/env bash
# Does the engine hand us its layer tree as subsurfaces?
#
#   nix develop .#full -c ./scripts/probe-delegated-compositing.sh
#
# This is the one question in docs/architecture/WINDOW-COMPOSITING.md's
# "Delegated compositing" section that the container it was written in could
# not answer, and it is the question the whole section rests on. With
# WaylandOverlayDelegation on, Chromium is supposed to stop flattening the page
# into one raster and start committing each quad of its layer tree as its own
# wl_subsurface. If it does, the bands go away: a window sits *between* two
# subsurfaces because we draw both and order them, and a page can use z-index
# like any other page. If it does not, bands are what we have.
#
# It needs a GPU. Delegated compositing is a Viz path, and with no DRM render
# node the GPU process exits during initialisation, so there is nothing to
# delegate *from* and no amount of protocol will produce a quad. That is not a
# failure of the idea and this script says so rather than reporting a red.
#
# The measurement is a comparison, not a reading. Chromium makes subsurfaces
# for other reasons, so "some subsurfaces arrived" proves nothing on its own.
# The same app is run twice — once with delegation off, once on — and the two
# counts are compared. Only the difference is evidence.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
cargo build -p domicile-compositor >/dev/null 2>&1 || {
  echo "the compositor did not build; run: nix develop .#full -c cargo build -p domicile-compositor"
  exit 1
}
[ -x "$BIN" ] || { echo "no compositor at $BIN after building"; exit 1; }

export XDG_RUNTIME_DIR="/tmp/domicile-rt-delegate"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
COMPLOG="$(mktemp)"; OFFLOG="$(mktemp)"; FEWLOG="$(mktemp)"; ONLOG="$(mktemp)"
APPDIR="$(mktemp -d)"
APP=""

RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" $APP 2>/dev/null; rm -rf "$COMPLOG" "$OFFLOG" "$FEWLOG" "$ONLOG" "$APPDIR"; }
trap cleanup EXIT
for _ in $(seq 1 200); do [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && break; sleep 0.05; done
if [ ! -S "$XDG_RUNTIME_DIR/wayland-1" ]; then
  # With what it said, which is the whole difference between a failure that
  # names itself and one that restates the symptom. This line read
  # "the compositor never opened wayland-1" and nothing else, and the reason —
  # a required argument this script did not pass — was in a log it deleted on
  # the way out. Twice as long to write and it answers itself.
  echo "FAIL: the compositor never opened wayland-1, so there is nothing for"
  echo "  the engine to be a client of. What it said:"
  sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | grep -avE "GL_|Supported (GL|EGL)" | tail -8 | sed 's/^/  /'
  exit 1
fi

# A page whose layer count this script chooses. `will-change: transform` is the
# ordinary web-developer way to ask for a compositing layer, which is the point:
# if delegation works, the thing that arrives as separate subsurfaces is the
# thing a page author already knows how to ask for — and it arrives once per
# layer, which is what makes the count mean something.
cat >"$APPDIR/package.json" <<'JSON'
{ "name": "domicile-delegation-probe", "version": "0.0.0", "main": "main.js" }
JSON
cat >"$APPDIR/main.js" <<'JS'
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 600, height: 400, frame: false });
  const layer = (i) =>
    `<div style="position:absolute;left:${i * 40}px;top:${i * 30}px;width:200px;` +
    `height:150px;background:hsl(${i * 60},80%,50%);will-change:transform;` +
    `transform:translateZ(0)"></div>`;
  win.loadURL(
    "data:text/html," +
      encodeURIComponent(
        "<html><body style='margin:0;background:#222'>" +
          Array.from({ length: Number(process.env.LAYERS) }, (_, i) => layer(i)).join("") +
          "</body></html>",
      ),
  );
  // Long enough for the first frames to go through Viz, short enough that the
  // script is not something you leave running.
  setTimeout(() => app.quit(), 8000);
});
JS

# WAYLAND_DEBUG rather than Chromium's own --vmodule logging. A subsurface
# either exists on the wire or it does not; reading it off the protocol means
# the answer does not depend on Chromium keeping a log line we happened to grep
# for. NO_COLOR because libwayland otherwise writes SGR escapes into the trace.
run_engine() { # $1 = extra features, $2 = logfile, $3 = how many layers the page draws
  LAYERS="$3" \
  NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    electron --no-sandbox --ozone-platform=wayland \
    --enable-features="UseOzonePlatform$1" \
    --enable-logging=stderr --v=1 --vmodule="*wayland*=3" \
    "$APPDIR" >"$2" 2>&1 &
  APP=$!
  wait "$APP" 2>/dev/null
  APP=""
}
subsurfaces() { grep -ac "get_subsurface" "$1" 2>/dev/null || true; }

echo "== can this machine answer at all? =="
if ! ls /dev/dri/renderD* >/dev/null 2>&1; then
  echo "UNKNOWN: no DRM render node here."
  echo "  Delegated compositing is a Viz path. With no render node the GPU process"
  echo "  exits during initialisation, so there is no compositor to delegate from"
  echo "  and no quad can arrive however much protocol we speak. This machine"
  echo "  cannot tell a working path from a broken one. Run it where there is a GPU."
  exit 0
fi
echo "PASS: $(ls /dev/dri/renderD* | tr '\n' ' ')"

echo
# Three runs, not two, and the third is what makes the answer mean something.
#
# "More subsurfaces than the flat path" is too weak a bar, and this script set
# it and passed on `1`: a single subsurface is equally what a compositor gets
# when Chromium wraps the whole page in one delegated root and goes on
# flattening everything into it. What tells a layer *tree* from a layer is
# whether the count follows the page. So the page is drawn once with one
# composited layer and once with eight, and the difference between those two
# is the only number that answers the question.
LAYERS_FEW=1
LAYERS_MANY=8
DELEGATED=",WaylandOverlayDelegation,DelegatedCompositing"

echo "== baseline: the engine with delegation off =="
run_engine "" "$OFFLOG" "$LAYERS_MANY"
if ! grep -aq "wl_compositor" "$OFFLOG"; then
  echo "FAIL: the engine never spoke to Domicile — nothing below this means anything."
  cut -c1-200 "$OFFLOG" | tail -12 | sed 's/^/  /'
  exit 1
fi
OFF=$(subsurfaces "$OFFLOG")
echo "$OFF with $LAYERS_MANY layers and no delegation"

echo
echo "== delegation on, and the page kept small =="
run_engine "$DELEGATED" "$FEWLOG" "$LAYERS_FEW"
FEW=$(subsurfaces "$FEWLOG")
echo "$FEW with $LAYERS_FEW layer"

echo
echo "== delegation on, and the page eight layers deep =="
run_engine "$DELEGATED" "$ONLOG" "$LAYERS_MANY"
ON=$(subsurfaces "$ONLOG")
echo "$ON with $LAYERS_MANY layers"

echo
echo "== did the GPU process survive? =="
if grep -aq "Exiting GPU process due to errors" "$ONLOG"; then
  echo "UNKNOWN: the GPU process exited during initialisation even with a render node."
  echo "  Everything below the GPU is unanswerable until this is fixed; the"
  echo "  counts above are measuring the software path."
  grep -aiE "drm render node|InitializeGL|gpu process" "$ONLOG" | cut -c1-160 | tail -6 | sed 's/^/  /'
  exit 1
fi
echo "PASS: no GPU-process initialisation failure in the log"

echo
echo "== what the engine still asks for and does not get =="
# Chromium names each missing protocol on its own line and then falls back
# without erroring, so this list is the remaining work rather than a fault.
MISSING=$(grep -ao "Server doesn't support [a-z_0-9]*" "$ONLOG" | sort -u)
if [ -z "$MISSING" ]; then
  echo "nothing — every protocol it asked for is advertised"
else
  echo "$MISSING" | sed 's/^/  /'
fi

echo
echo "== the answer =="
GREW=$((ON - FEW))
WANTED=$((LAYERS_MANY - LAYERS_FEW))
if [ "$GREW" -ge "$WANTED" ]; then
  echo "YES: seven more layers on the page brought $GREW more subsurfaces."
  echo "  The count follows the page, so what arrives is the layer tree rather"
  echo "  than one delegated root with everything flattened into it. Bands can"
  echo "  go: a window goes between two quads because we draw both and order"
  echo "  them, and z-index means what it means anywhere else."
elif [ "$ON" -gt "$OFF" ]; then
  echo "PARTLY: delegation makes subsurfaces the flat path does not — $ON against"
  echo "  $OFF — but the count does not follow the page: $FEW for $LAYERS_FEW layer"
  echo "  and $ON for $LAYERS_MANY. That is a delegated *root* rather than a"
  echo "  delegated tree, and the page is still being flattened into it. Bands"
  echo "  cannot go on this. The list above is what to implement next; where it"
  echo "  is empty, the next question is Chromium's own vmodule output for why"
  echo "  it is declining to promote each layer."
else
  echo "NO: not one subsurface, either way."
  echo "  The engine is still flattening the page into a single raster. If the"
  echo "  list above is non-empty, implement those and run this again."
fi
