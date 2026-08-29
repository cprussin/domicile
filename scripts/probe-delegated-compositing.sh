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

# The features this asks the engine for, named once so that what is checked
# and what is passed cannot drift apart.
WANTED_FEATURES="WaylandOverlayDelegation"

# And the one switched off for the last run, checked the same way: a
# `--disable-features` name the engine does not know is ignored just as
# silently as an `--enable-features` one, and a run that disabled nothing would
# read exactly like a run that disabled something and saw no change.
COLOUR_FEATURE="WaylandWpColorManagerV1"

# Spelled the same way the compositor logs them, since these are read back out
# of its own output.
AUGMENTER_BOUND="the engine bound surface_augmenter"
AUGMENTER_ASKED="the engine asked the augmenter for something"

# The page's size, named here because the buffer sizes on the wire are read
# against it: a buffer the size of the page is the page delegated as one thing,
# and a buffer smaller than it is a quad.
PAGE_WIDE=600
PAGE_TALL=400

export XDG_RUNTIME_DIR="/tmp/domicile-rt-delegate"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
COMPLOG="$(mktemp)"; OFFLOG="$(mktemp)"; FEWLOG="$(mktemp)"
ONLOG="$(mktemp)"; NOCOLOURLOG="$(mktemp)"
APPDIR="$(mktemp -d)"
APP=""

RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" \
  --experiment-augmenter >"$COMPLOG" 2>&1 &
COMP=$!
cleanup() { kill -9 "$COMP" $APP 2>/dev/null; rm -rf "$COMPLOG" "$OFFLOG" "$FEWLOG" "$ONLOG" "$NOCOLOURLOG" "$APPDIR"; }
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
  const win = new BrowserWindow({
    width: Number(process.env.PAGE_WIDE),
    height: Number(process.env.PAGE_TALL),
    frame: false,
  });
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
# $1 = the whole --enable-features value, empty for none; $2 = logfile;
# $3 = how many composited layers the page draws.
#
# Empty means the flag is left off rather than passed empty, which is the
# difference between "no features asked for" and "a feature named the empty
# string". `--ozone-platform=wayland` stays either way: it is a switch, not a
# feature, and it is how the engine is told which platform to be.
# $4, when given, is a feature to switch *off* — which is a different question
# from the ones above and answerable without implementing anything.
run_engine() {
  local features=()
  [ -n "$1" ] && features=(--enable-features="$1")
  [ -n "${4:-}" ] && features+=(--disable-features="$4")
  LAYERS="$3" PAGE_WIDE="$PAGE_WIDE" PAGE_TALL="$PAGE_TALL" \
  NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    electron --no-sandbox --ozone-platform=wayland "${features[@]}" \
    --enable-logging=stderr --v=1 \
    --vmodule="*wayland*=3,*overlay*=3,*delegat*=3,*skia_renderer*=2" \
    "$APPDIR" >"$2" 2>&1 &
  APP=$!
  wait "$APP" 2>/dev/null
  APP=""
}
subsurfaces() { grep -ac "get_subsurface" "$1" 2>/dev/null || true; }

# What the engine asked of the augmenter, which is this experiment's whole
# reason for existing.
#
# `exo`, the ChromeOS compositor, is the one server known to make the engine
# send a quad per composited layer, and `surface_augmenter` is its own protocol
# and the last difference between that server and this one. The compositor
# advertises it under `--experiment-augmenter` and implements *none* of it: it
# logs what is asked and honours nothing. That is only defensible because the
# flag defaults off and cannot reach a desktop, and because what the engine
# asks for is exactly the evidence wanted.
#
# A `kind="subsurface"` is the engine naming a quad it means to place. That
# line appearing at all is the answer.
augmenter() {
  if ! grep -aq "$AUGMENTER_BOUND" "$COMPLOG"; then
    echo "NO: it never bound the augmenter, though one was advertised."
    echo "  A client binds the globals it wants when it enumerates the"
    echo "  registry, before it renders anything, so this is not a decision"
    echo "  the engine deferred. It is not looking for an augmenter at all,"
    echo "  and it does not gate delegation on finding a compositor shaped"
    echo "  like exo. That closes the last lever, and the negative result in"
    echo "  docs/architecture/WINDOW-COMPOSITING.md is final."
    return
  fi
  echo "YES: it bound the augmenter. What it then asked for:"
  local asked
  asked=$(sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG" | grep -a "$AUGMENTER_ASKED" \
    | grep -oE 'kind="[a-z ]*"' | sort | uniq -c | sed 's/^ *//')
  if [ -z "$asked" ]; then
    echo "  ...and then asked it for nothing."
  else
    printf '%s\n' "$asked" | sed 's/^/  /'
    echo "  A kind=\"subsurface\" is the engine naming a quad it means to"
    echo "  place. One per composited layer is the layer tree."
  fi
}

# What Chromium said about promoting quads, for an answer that is not yes.
#
# The protocol list this prints says what the engine *asked* for; this says
# what it decided. They are different questions and only the second names a
# cause: a missing global is a thing to implement, and whether implementing it
# would change anything is exactly what these lines answer. Guessing instead —
# implement whatever is missing, run this again — is a round trip per guess.
#
# Matched on the *file* rather than on the words, and that is not fussiness.
# Matching "delegat" anywhere in a line brings in `NetworkDelegate`, the
# zygote's "0 fork delegates", and — measured, on the first draft of this —
# every path under the probe's own `domicile-delegation-probe` config
# directory. Promotion is decided in a handful of files and naming them is what
# makes this readable rather than something to scroll past.
DECIDERS='(overlay_processor[a-z_]*|overlay_candidate[a-z_]*|skia_renderer|wayland_overlay[a-z_]*|delegated_frame[a-z_]*)[.]cc'
why() {
  local said
  said=$(grep -aoE "[A-Za-z0-9_/]*$DECIDERS:[0-9]+\].*" "$1" | sort -u | head -25)
  echo
  echo "  --- what the engine said about promoting quads:"
  if [ -n "$said" ]; then
    printf '%s\n' "$said" | cut -c1-160 | sed 's/^/  /'
  else
    echo "  nothing, and widening --vmodule will not change that. A release"
    echo "  build compiles its DVLOGs out, and the engine's own binary bears"
    echo "  that out: of the files that decide promotion only overlay_strategy"
    echo "  embeds a path at all. The engine cannot be made to explain itself"
    echo "  here; what it *did* is on the wire below."
  fi
}

# What the engine actually sent, which is the evidence that does not depend on
# a release build having kept a log line.
#
# The counts above answer "how many subsurfaces" and stop there. Everything
# else needed to tell a delegated root from a delegated tree is already in the
# trace and was being thrown away: how many surfaces were made at all, whether
# any were stacked against each other, whether a viewport scaled them, and —
# the one that settles it — how big the buffers were. A quad is smaller than
# the page. A root is the page.
wire() {
  local trace="$1"
  echo
  echo "  --- what the engine put on the wire:"
  printf '  %-28s %s\n' \
    "wl_surface created"      "$(grep -ac 'create_surface' "$trace" || true)" \
    "wl_subsurface created"   "$(grep -ac 'get_subsurface' "$trace" || true)" \
    "wp_viewport created"     "$(grep -ac 'get_viewport' "$trace" || true)" \
    "place_above/place_below" "$(grep -acE 'place_(above|below)' "$trace" || true)" \
    "set_buffer_scale"        "$(grep -ac 'set_buffer_scale' "$trace" || true)"
  # Buffer sizes, which is where a quad and a page tell themselves apart. A
  # dmabuf states its dimensions when it is created, so the distinct sizes the
  # engine allocated are the sizes of the things it drew.
  # `[@#]` because libwayland spells an object id both ways depending on its
  # version, and a pattern that assumed one of them read every trace as having
  # no buffers at all — silently, since "no buffers" is a plausible answer for
  # a client that never painted.
  #
  # Two spellings again below, because the two buffer kinds state their size in
  # different argument positions: a dmabuf gives width and height straight after the new
  # id, and an shm buffer gives an offset first. Reading the dmabuf pattern
  # against an shm trace silently yields the offset and the width, which is a
  # plausible-looking pair of numbers and the wrong one.
  local sizes
  sizes=$(
    {
      grep -aoE 'create_immed\(new id wl_buffer[@#][0-9]+, [0-9]+, [0-9]+' "$trace" \
        | grep -oE '[0-9]+, [0-9]+$'
      grep -aoE 'create_buffer\(new id wl_buffer[@#][0-9]+, [0-9]+, [0-9]+, [0-9]+' "$trace" \
        | grep -oE '[0-9]+, [0-9]+$'
    } | sort -u | head -12
  )
  if [ -n "$sizes" ]; then
    echo "  buffers allocated, by size:"
    printf '%s\n' "$sizes" | sed 's/^/    /'
    echo "  The page is $PAGE_WIDE x $PAGE_TALL, give or take the frame the"
    echo "  engine draws around it. A buffer about that size is the page"
    echo "  delegated as one thing; buffers markedly smaller than it are quads."
  else
    echo "  no dmabuf allocations named a size in the trace, so what was drawn"
    echo "  cannot be told apart from here."
  fi
}

# Where the engine's own binary is, which is not what `command -v` gives on a
# packaged build: that is a small script whose job is to exec the real thing
# with an environment set up. Followed here so the feature names can be read
# out of it, and left empty rather than guessed at when it cannot be found.
engine_binary() {
  local exe named
  exe=$(command -v electron) || return 0
  exe=$(readlink -f "$exe")
  # Big enough to be the engine itself rather than a script that starts it.
  # Chromium is a quarter of a gigabyte; a wrapper is a couple of kilobytes,
  # and the paths it mentions include directories called `electron` as well as
  # the binary, so the size is what tells them apart rather than the name.
  if [ "$(stat -c %s "$exe" 2>/dev/null || echo 0)" -lt 10000000 ]; then
    while read -r named; do
      if [ -f "$named" ] && [ "$(stat -c %s "$named" 2>/dev/null || echo 0)" -gt 10000000 ]; then
        exe="$named"
        break
      fi
    done <<<"$(grep -aoE "/nix/store/[^\"' ]*electron[^\"' ]*" "$exe" 2>/dev/null | sort -u)"
  fi
  [ -f "$exe" ] && [ "$(stat -c %s "$exe" 2>/dev/null || echo 0)" -gt 10000000 ] && printf '%s' "$exe"
}

echo "== are the features we ask for real? =="
# `--enable-features` ignores a name it does not recognise, without a word.
# That is not a hypothetical failure: this probe passed `DelegatedCompositing`
# and `UseOzonePlatform` on every run for its whole life, neither of which is a
# feature name in this engine, and reported the result as though both were on.
# Two round trips through a person with a GPU went to measuring a flag that was
# never set. So the names are checked against the binary before anything is run
# — an unchecked name is a run that may be measuring nothing.
ENGINE=$(engine_binary)
if [ -z "$ENGINE" ]; then
  echo "UNKNOWN: the engine's own binary could not be found, so the feature"
  echo "  names below go unchecked. Everything after this reports on whichever"
  echo "  of them the engine happened to recognise."
elif ! command -v strings >/dev/null 2>&1; then
  echo "UNKNOWN: no \`strings\`, so the feature names go unchecked. As above."
else
  for feature in $WANTED_FEATURES $COLOUR_FEATURE; do
    if strings -a "$ENGINE" | grep -qx "$feature"; then
      echo "  $feature: a real feature in this engine"
    else
      echo "FAIL: $feature is not a feature name in this engine."
      echo "  The engine would ignore it silently and this probe would report"
      echo "  the run as though it were on. Either the name changed or it never"
      echo "  existed; \`strings\` on the binary is how to find what replaced it."
      echo "  Read from: $ENGINE"
      exit 1
    fi
  done
fi

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
# One feature, not two. `DelegatedCompositing` was in this list for the whole
# life of this probe and is not a feature name in this engine at all, so every
# run that named it was measuring `WaylandOverlayDelegation` alone and
# reporting it as both. `UseOzonePlatform` went the same way: it was removed
# from Chromium once Ozone became the only platform, and it was being passed on
# every run including the baseline. See the check above, which is there so this
# cannot happen quietly again.
DELEGATED="$WANTED_FEATURES"

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
echo "== and again with colour management switched off in the engine =="
# The one protocol the engine asks for and does not get is
# `wp_color_management_surface_v1`, and the obvious next move is to implement
# it. This run is what makes that a decision rather than a bet: turning the
# engine's own colour-management feature *off* takes the protocol out of the
# question entirely, for the price of one run and no compositor work at all.
#
# If the count climbs with it off, colour management was what held promotion
# back and implementing it is the work. If the count does not move, it was
# never the blocker, and a protocol that has to actually convert colour rather
# than merely accept objects would have been built for nothing.
#
# Disabling rather than implementing is the cheap half of the experiment and it
# runs first on purpose.
run_engine "$DELEGATED" "$NOCOLOURLOG" "$LAYERS_MANY" "$COLOUR_FEATURE"
NOCOLOUR=$(subsurfaces "$NOCOLOURLOG")
echo "$NOCOLOUR with $LAYERS_MANY layers and no $COLOUR_FEATURE"

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
echo "== did the engine want an augmenter? =="
augmenter

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
  echo "  cannot go on this."
  if [ "$NOCOLOUR" -gt "$ON" ]; then
    echo
    echo "  And colour management is why: with $COLOUR_FEATURE off the count"
    echo "  went to $NOCOLOUR. The engine declines to promote a quad it cannot"
    echo "  state a colour space for, so implementing"
    echo "  wp_color_management_surface_v1 is the work — and it has to convert"
    echo "  colour rather than merely accept the objects, or this comes back."
  else
    echo
    echo "  And colour management is *not* why: with $COLOUR_FEATURE off the"
    echo "  count is $NOCOLOUR against $ON, so the protocol the engine keeps"
    echo "  asking for is not what holds promotion back. Implementing it would"
    echo "  have been a protocol built for nothing."
  fi
  why "$ONLOG"
  wire "$ONLOG"
else
  echo "NO: not one subsurface, either way."
  echo "  The engine is still flattening the page into a single raster."
  why "$ONLOG"
  wire "$ONLOG"
fi
