#!/usr/bin/env bash
# Prove the compositor advertises `zwp_linux_dmabuf_v1`, which is what a GPU
# client binds before it can hand over a buffer at all.
#
#   nix develop .#full -c ./scripts/e2e-dmabuf.sh
#
# Nothing appears on screen: this is a headless check of the message plane, with
# no chrome and no output; a desktop that draws is what opens a window.
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
  "$BIN" --session "$SOCK.session" --chrome-socket "$SOCK" >"$COMPLOG" 2>&1 &
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
  elif ! command -v wayland-info >/dev/null 2>&1; then
    # Without the tool there is no evidence either way, and the branch below
    # would read `command not found` as a blocked event loop — accusing the
    # compositor on the strength of a missing package.
    echo "  (no wayland-info here, so whether it is still answering is unknown)"
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

# The import itself is no longer this script's to prove. It used to read a
# client's dmabuf back and assert the pixels reached the chrome; that path is
# deleted, and a client's buffer now goes to the display compositor through the
# engine. What proves it end to end is
# `packages/domicile-engine/scripts/spike-client-window.sh`, which needs a
# Chromium build and a GPU and so cannot live here.
#
# What is left is the half that runs anywhere and is worth running: the global
# is advertised, which is what every dmabuf client binds before it draws.
exit 0
