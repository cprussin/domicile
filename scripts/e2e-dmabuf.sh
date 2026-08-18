#!/usr/bin/env bash
# Prove the zero-copy dmabuf path: a GPU client's buffers are imported by the
# compositor and its pixels reach the chrome.
#
#   nix develop .#full -c ./scripts/e2e-dmabuf.sh
#
# Nothing appears on screen: this is a headless check of the message plane, with
# no chrome and no output. `run-prototype.sh` is the one that opens a window.
#
# Unlike the other e2e scripts this one needs REAL GPU HARDWARE — a DRM render
# node (/dev/dri/renderD*) the client can allocate against. Without one the
# compositor still advertises the global (Mesa's software EGL is enough for
# that), but no client can produce a buffer, so the second half is skipped
# rather than failed.
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

export XDG_RUNTIME_DIR="/tmp/domicile-rt-dmabuf"   # short: Unix socket path limit
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
rm -f "$XDG_RUNTIME_DIR"/wayland-* "$XDG_RUNTIME_DIR"/c.sock
SOCK="$XDG_RUNTIME_DIR/c.sock"
CHROME="$(mktemp)"
COMPLOG="$(mktemp)"
CLILOG="$(mktemp)"
MOCK=""; CLI=""

# Frame handling logs at debug: this script's whole job is telling apart
# "no commit arrived" from "imported but never delivered".
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$BIN" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
disown "$COMP" 2>/dev/null || true   # so teardown's kill doesn't print "Killed"
cleanup() { kill -9 "$COMP" $MOCK $CLI 2>/dev/null; rm -f "$CHROME" "$COMPLOG" "$CLILOG"; }
trap cleanup EXIT

# The compositor logs through `tracing`, which colours its field names; the
# greps below read the log as plain text.
plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

# Everything the compositor has to say about a failure. A `.expect()` in the
# import path aborts the process, and a Rust panic is not one of tracing's
# levels, so it has to be matched separately or it goes unseen.
compositor_trouble() {
  plain | grep -aE "[[:space:]](WARN|ERROR)[[:space:]]|panicked at|stack backtrace" \
    | cut -c1-300 | tail -8
  if ! kill -0 "$COMP" 2>/dev/null; then
    echo "  (the compositor process is gone: it died mid-run)"
  # A compositor that is alive but not answering has blocked its event loop —
  # usually on the GPU — and a client waiting for a frame callback looks exactly
  # like a client that never drew. Binding a global proves the loop still turns.
  elif WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info >/dev/null 2>&1; then
    echo "  (the compositor is alive and still answering clients)"
  else
    echo "  (the compositor is alive but NOT answering: its event loop is blocked)"
  fi
  echo "  --- the last thing the compositor did (whole lines: the timestamps say"
  echo "      whether it is stuck on the last step or finished it long ago):"
  # Whole lines, not `grep -o` fragments: the module path is `…::dmabuf_import`,
  # so matching bare words pulls "import:" out of it and drops both the stage
  # name and the fields (buffer size, payload bytes) that make the line useful.
  plain | grep -aE "readback:|outbound:|dropped a frame|broadcast app frame|buffer released|toplevel mapped|chrome client connected" \
    | sed 's/^[0-9-]*T//' | cut -c1-150 | tail -18 | sed 's/^/  /'
}

# One line of the handshake tally: how many times the client saw or sent an event.
handshake_step() { printf '  %-30s %s\n' "$1" "$(grep -acE "$2" "$CLILOG")"; }

# A client that cannot set up its GPU context creates its window first and gives
# up after — which from the compositor's side is indistinguishable from a client
# that is merely slow. Its own output is the only place that shows.
client_trouble() {
  # The client's own messages: everything that is not a `[123.456]` protocol line.
  echo "  --- what ${GPU_CLIENT[0]} said:"
  grep -avE '^[[:space:]]*\[[0-9:]+\.[0-9]+\]' "$CLILOG" | cut -c1-300 | tail -10 | sed 's/^/  /'
  kill -0 "$CLI" 2>/dev/null && echo "  (it is still running)" || echo "  (it has exited)"

  echo "  --- globals it bound:"
  grep -aoE 'wl_registry[#@][0-9]+\.bind\([0-9]+, "[^"]+"' "$CLILOG" \
    | sed 's/.*, "//; s/"$//' | sort -u | tr '\n' ' ' | sed 's/^/  /'; echo
  echo "  --- how far the handshake got (event: times seen):"
  handshake_step "xdg_surface.configure"        "xdg_surface[#@][0-9]+\.configure"
  handshake_step "xdg_surface.ack_configure"    "xdg_surface[#@][0-9]+\.ack_configure"
  handshake_step "wl_surface.enter"             "wl_surface[#@][0-9]+\.enter"
  handshake_step "linux_buffer_params.create"   "zwp_linux_buffer_params[_v1]*[#@][0-9]+\.create"
  handshake_step "wl_surface.attach"            "wl_surface[#@][0-9]+\.attach"
  handshake_step "wl_surface.commit"            "wl_surface[#@][0-9]+\.commit"
  echo "  --- the last thing it did:"
  grep -aE '^[[:space:]]*\[[0-9:]+\.[0-9]+\]' "$CLILOG" | cut -c1-160 | tail -8 | sed 's/^/  /'
}
for _ in $(seq 1 200); do { [ -S "$XDG_RUNTIME_DIR/wayland-1" ] && [ -S "$SOCK" ]; } && break; sleep 0.05; done

echo "== the renderer the compositor imports on =="
plain | grep -oE 'GL Renderer: "[^"]*"' | head -1
plain | grep -oE 'advertising zwp_linux_dmabuf_v1 count=[0-9]+ feedback=[a-z]+' | head -1

echo "== what a real client sees =="
WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null \
  | grep -oE "interface: 'zwp_linux_dmabuf_v1',[[:space:]]*version:[[:space:]]*[0-9]+" | head -1
if WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info 2>/dev/null | grep -q zwp_linux_dmabuf_v1; then
  echo "PASS: the compositor advertises zwp_linux_dmabuf_v1"
else
  echo "FAIL: the compositor advertised no dmabuf global. Its own reason:"
  # The compositor logs exactly why it gave up on EGL — a missing libEGL, no
  # device, a context it could not create — so print that rather than guess.
  compositor_trouble
  echo "  (libEGL is dlopen'd, so it must be on LD_LIBRARY_PATH, not just linkable.)"
  exit 1
fi

if ! ls /dev/dri/renderD* >/dev/null 2>&1; then
  echo "SKIP: no DRM render node, so no client can allocate a dmabuf here."
  echo "      Run this on a machine with a GPU to exercise the import itself."
  exit 0
fi
# Any client that renders through EGL allocates a dmabuf once the global is up.
# `weston-simple-dmabuf-egl` is the most focused one, but nixpkgs builds weston
# with `simple-clients` off, so the full shell falls back to kitty — which is
# the client this whole path exists for anyway.
if command -v weston-simple-dmabuf-egl >/dev/null 2>&1; then
  GPU_CLIENT=(weston-simple-dmabuf-egl)
elif command -v kitty >/dev/null 2>&1; then
  # Keep it drawing: an idle terminal commits once and stops, and the chrome
  # attaches only after the window maps, so there would be nothing left to see.
  # Pin a modest window: left to itself kitty picks one sized to the output, and
  # a 1753x1753 frame is 12MB per redraw. In the real chrome the `<app>` element
  # drives the size through `resize_app`, so a fixed one is the honest stand-in.
  GPU_CLIENT=(kitty --config NONE -o confirm_os_window_close=0
              -o initial_window_width=640 -o initial_window_height=480
              sh -c 'while :; do date; sleep 0.2; done')
else
  echo "SKIP: no GPU client on PATH (wanted weston-simple-dmabuf-egl or kitty)."
  exit 0
fi
echo "== driving ${GPU_CLIENT[0]} =="

# WAYLAND_DEBUG puts the whole protocol conversation on the client's stderr,
# which is the only way to see what a mapped-but-blank client is waiting for.
# NO_COLOR because current libwayland writes SGR escapes between the interface
# name and the event, and the handshake tally below reads the log as plain text.
NO_COLOR=1 WAYLAND_DEBUG=1 WAYLAND_DISPLAY=wayland-1 timeout 60 "${GPU_CLIENT[@]}" >"$CLILOG" 2>&1 &
CLI=$!
disown "$CLI" 2>/dev/null || true

# Wait for the window before connecting the chrome. The mock chrome listens for
# only a few seconds, and a cold kitty (font cache, GPU init) can take longer
# than that to map — connecting after the fact still catches frames, because
# every commit is broadcast to whoever is attached at the time.
for _ in $(seq 1 200); do plain | grep -q "toplevel mapped" && break; sleep 0.1; done
if ! plain | grep -q "toplevel mapped"; then
  echo "FAIL: ${GPU_CLIENT[0]} never mapped a window, so nothing was ever imported."
  compositor_trouble
  client_trouble
  exit 1
fi
# Wait for the compositor to actually import one — reading our own log, not the
# client's debug output. A cold GPU client (font cache, GPU init, shader
# compile) can be many seconds from mapping its window to drawing into it.
echo "== the client mapped; waiting for the compositor to import a frame =="
for _ in $(seq 1 300); do
  [ "$(plain | grep -ac 'broadcast app frame')" -ge 1 ] && break
  sleep 0.1
done
imported=$(plain | grep -ac "broadcast app frame")
echo "frames imported: $imported"
if [ "$imported" -lt 1 ]; then
  echo "FAIL: ${GPU_CLIENT[0]} mapped a window but the compositor imported nothing."
  compositor_trouble
  client_trouble
  exit 1
fi

# The chrome attaches once frames are flowing, and holds the line long enough to
# catch them. Frames produced before it connects go to nobody: the compositor
# broadcasts to whoever is attached, and drops rather than queues when behind.
DOMICILE_CHROME_LISTEN_MS=25000 DOMICILE_CHROME_SOCK="$SOCK" \
  bun "$ROOT/packages/e2e-harness/src/mock-chrome.ts" >"$CHROME" 2>&1 &
MOCK=$!
disown "$MOCK" 2>/dev/null || true
# Nothing reaches a chrome the compositor has not accepted yet, and a harness
# that died on startup is indistinguishable from one that saw no frames.
for _ in $(seq 1 200); do
  plain | grep -aq "chrome client connected" && break
  sleep 0.05
done
if ! plain | grep -aq "chrome client connected"; then
  echo "FAIL: the mock chrome never connected, so nothing could be delivered."
  echo "  --- what the harness said:"
  cut -c1-200 "$CHROME" | tail -6 | sed 's/^/  /'
  exit 1
fi
# Two frames, not one: a client that draws once and freezes is the failure this
# path is here to rule out, and one frame cannot tell the two apart.
for _ in $(seq 1 150); do [ "$(grep -c '"app_frame"' "$CHROME")" -ge 2 ] && break; sleep 0.1; done

echo "== frames the chrome received from the GPU client =="
# The payload is a base64 blob per frame, so report the shape, not the bytes.
grep -oE '"type":"app_frame","app_id":"[^"]*","width":[0-9]+,"height":[0-9]+' "$CHROME" | head -3
frames=$(grep -c '"app_frame"' "$CHROME")
if [ "$frames" -ge 2 ]; then
  echo "PASS: $frames dmabuf frames imported and delivered to the chrome"
else
  echo "FAIL: ${GPU_CLIENT[0]} mapped a window, but only $frames frame(s) reached the chrome."
  compositor_trouble
  client_trouble
  exit 1
fi
