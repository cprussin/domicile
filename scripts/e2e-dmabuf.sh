#!/usr/bin/env bash
# Checks the compositor advertises `zwp_linux_dmabuf_v1`, which a GPU client
# binds before it can send a buffer.
#
#   nix develop .#full -c ./scripts/e2e-dmabuf.sh
#
# Headless: no chrome and no output. Mesa's software EGL is enough to
# advertise the global.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/target/debug/domicile-compositor"
# Always build: a stale binary would test code that is not in the tree.
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

# Trace level logs buffer releases, which separate "no commit arrived" from
# "imported but never delivered".
RUST_LOG="${RUST_LOG:-info,domicile_compositor=trace}" \
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
COMP=$!
disown "$COMP" 2>/dev/null || true   # so teardown's kill doesn't print "Killed"
cleanup() { kill -9 "$COMP" $MOCK $CLI 2>/dev/null; rm -f "$CHROME" "$COMPLOG" "$CLILOG"; }
trap cleanup EXIT

# Strips tracing's color escapes so the greps below match.
plain() { sed 's/\x1b\[[0-9;]*m//g' "$COMPLOG"; }

# Prints the compositor's warnings, errors and panics. Panics are not tracing
# levels, so they are matched separately.
compositor_trouble() {
  plain | grep -aE "[[:space:]](WARN|ERROR)[[:space:]]|panicked at|stack backtrace" \
    | cut -c1-300 | tail -8
  if ! kill -0 "$COMP" 2>/dev/null; then
    echo "  (the compositor process is gone: it died mid-run)"
  # A blocked event loop (often on the GPU) looks like a client that never
  # drew. Binding a global with wayland-info shows the loop still runs.
  elif ! command -v wayland-info >/dev/null 2>&1; then
    # Without wayland-info, the next branch would misreport a blocked loop.
    echo "  (no wayland-info here, so whether it is still answering is unknown)"
  elif WAYLAND_DISPLAY=wayland-1 timeout 5 wayland-info >/dev/null 2>&1; then
    echo "  (the compositor is alive and still answering clients)"
  else
    echo "  (the compositor is alive but NOT answering: its event loop is blocked)"
  fi
  echo "  --- the last thing the compositor did (whole lines: the timestamps say"
  echo "      whether it is stuck on the last step or finished it long ago):"
  # Whole lines, not `grep -o`: the module path `…::dmabuf_import` would
  # match "import:" and drop the stage name and fields.
  plain | grep -aE "readback:|outbound:|dropped a frame|broadcast app frame|buffer released|toplevel mapped|chrome client connected" \
    | sed 's/^[0-9-]*T//' | cut -c1-150 | tail -18 | sed 's/^/  /'
}

# Prints how many times the client saw or sent an event.
handshake_step() { printf '  %-30s %s\n' "$1" "$(grep -acE "$2" "$CLILOG")"; }

# Prints the client's own output and handshake progress. A client that fails
# GPU setup after creating its window looks slow from the compositor's side.
client_trouble() {
  # Messages that are not `[123.456]` protocol lines.
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
  # The compositor logs why EGL setup failed.
  compositor_trouble
  echo "  (libEGL is dlopen'd, so it must be on LD_LIBRARY_PATH, not just linkable.)"
  exit 1
fi

# The import itself is checked end to end by
# `packages/domicile-engine/scripts/guard-client-window.sh`, which needs a
# Chromium build and a GPU.
exit 0
