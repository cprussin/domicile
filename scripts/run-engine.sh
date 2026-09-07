#!/usr/bin/env bash
# Run a Domicile desktop on the forked engine, with no Electron anywhere.
#
#   nix develop .#full -c ./scripts/run-engine.sh /build/chromium/src
#   nix develop .#full -c ./scripts/run-engine.sh /build/chromium/src simple
#
# The counterpart of run-native.sh, which runs the same shells under Electron
# with the compositor compositing. Here the browser is the display compositor:
# the shell's page embeds each client's surface into its own layer tree, and
# the compositor is a producer rather than a renderer. That is the whole point
# of the fork -- see docs/architecture/ENGINE-FORK.md.
#
# THREE PROCESSES, AND THE ORDER IS FORCED.
#
#   bridge      serves the shell's built page and the compositor's protocol
#               socket on one port, because a page has no way to open a unix
#               socket and `file:` has no origin to derive one from
#   chrome      the fork, on that page. It creates the broker socket
#   compositor  connects to that broker socket as a producer
#
# The compositor is last because it connects to a socket chrome creates, and
# chrome is not first only because it needs a URL to load. So the page is up,
# and talking, before the compositor exists -- which is why the bridge waits
# for it rather than closing. See engine-chrome-host/src/serve-shell.ts.
set -u

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  echo "usage: run-engine.sh <path to chromium/src> [shell]" >&2
  exit 1
fi
SHELL_NAME="${2:-simple}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_DIR="$ROOT/packages/shell-$SHELL_NAME"
[ -d "$SHELL_DIR" ] || {
  echo "no shell '$SHELL_NAME' — there is no packages/shell-$SHELL_NAME." >&2
  exit 1
}

OUT="${OUT:-out/Domicile}"
RUNTIME="${XDG_RUNTIME_DIR:-/tmp/domicile-engine-rt}"
mkdir -p "$RUNTIME"; chmod 700 "$RUNTIME"
export XDG_RUNTIME_DIR="$RUNTIME"

BROKER="${BROKER:-$RUNTIME/domicile-engine-broker}"
COMP_SOCK="${COMP_SOCK:-$RUNTIME/domicile-engine.sock}"
PROFILE="${PROFILE:-/tmp/domicile-engine-profile}"

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  echo "no engine at $CHROMIUM/$OUT/chrome; build it: ./packages/domicile-engine/scripts/build.sh $CHROMIUM" >&2
  exit 1
}
[ -f "$CHROMIUM/$OUT/libdomicile_engine.so" ] || {
  echo "no libdomicile_engine.so in $CHROMIUM/$OUT; build it: autoninja -C $OUT domicile_engine" >&2
  exit 1
}

STARTED=()
cleanup() {
  if [ ${#STARTED[@]} -gt 0 ]; then
    kill "${STARTED[@]}" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# The page, built the way the repository builds a shell — turbo's `build:vite`,
# filtered to this one, which is how `flake.nix` builds them too. Nothing here
# is a second way to build a shell.
#
# Not just this package's vite: `build:vite` depends on `^prepare` and
# `^build`, and both are needed on a checkout where nothing has been built.
# `styled-system/` is generated and gitignored, and the workspace packages a
# shell imports are published from `dist/` — `@domicile/chrome-sdk`'s exports
# map every entry point to `./dist/*.js`, so without it the page builds
# without the SDK in it and the shell never joins the compositor.
echo "building $SHELL_NAME's page"
(cd "$ROOT" && bun install --frozen-lockfile >/dev/null &&
   bun run turbo build:vite --filter="@domicile/shell-$SHELL_NAME") || {
  echo "the shell's page did not build" >&2
  exit 1
}
# Where the shell's own renderer config puts it. `main_window` is what the
# shell's `vite.renderer.config.ts` names the one window it opens, and it stays
# that here rather than being special-cased: this runs the shell's build, not a
# second one of our own.
PAGE_DIR="$SHELL_DIR/.vite/renderer/main_window"
[ -f "$PAGE_DIR/index.html" ] || {
  echo "the shell built no index.html; looked in $PAGE_DIR" >&2
  exit 1
}

cargo build -p domicile-compositor || exit 1

rm -f "$BROKER" "$COMP_SOCK" "$COMP_SOCK.session"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# 1. The bridge. It tolerates a compositor that is not there yet, which it
#    will not be for another second or so.
echo "serving $SHELL_NAME from $PAGE_DIR"
BRIDGE_URL_FILE="$(mktemp)"
DOMICILE_SOCKET="$COMP_SOCK" DOMICILE_ROOT="$PAGE_DIR" \
  bun "$ROOT/packages/engine-chrome-host/src/main.ts" >"$BRIDGE_URL_FILE" 2>&1 &
STARTED+=($!)

URL=""
for _ in $(seq 1 200); do
  URL="$(sed -n 's/^domicile: serving //p' "$BRIDGE_URL_FILE" | head -1)"
  [ -n "$URL" ] && break
  sleep 0.1
done
[ -n "$URL" ] || {
  echo "the bridge never said where it was serving. It said:" >&2
  cat "$BRIDGE_URL_FILE" >&2
  exit 1
}
echo "the shell is at $URL"

# 2. The engine, on that page.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform="${OZONE:-wayland}" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-blink-features=DomicileExternalSurface \
  --domicile-broker-socket="$BROKER" \
  "$URL" &
STARTED+=($!)

for _ in $(seq 1 300); do [ -S "$BROKER" ] && break; sleep 0.1; done
[ -S "$BROKER" ] || {
  echo "the engine never opened its broker socket at $BROKER" >&2
  exit 1
}

# 3. The compositor, as a producer to it.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$ROOT/target/debug/domicile-compositor" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" &
COMP=$!
STARTED+=("$COMP")

echo
echo "domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above."
echo "Ctrl-C to stop."
wait "$COMP"
