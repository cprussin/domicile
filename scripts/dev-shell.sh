#!/usr/bin/env bash
# A shell, running in Domicile, rebuilt as you edit it.
#
#   ./scripts/dev-shell.sh manganese
#   bun run --filter @domicile/shell-manganese start:dev
#
# WHAT THIS REPLACED, AND WHY IT HAD TO. `start:dev` used to be `vite`: a dev
# server, opened in whatever browser you had. That page has no compositor, no
# clients and no windows — `connectToHost` finds no host and hands the shell a
# transport that does nothing — so what you were looking at was the chrome with
# every window in it missing. Useful for a stylesheet and misleading for
# anything else, and it is not what "run the shell" should mean.
#
# So dev mode is the desktop now. The engine, the compositor, the bridge and
# the shell, exactly as `nix run .#manganese` assembles them — with two
# differences, both of which exist to make an edit cheap:
#
#   - the page is rebuilt on save, by the shell's own vite in watch mode
#   - the page reloads itself when that finishes, because a desktop runs under
#     `--app` and there is no reload in it. See `shell-document.ts`.
#
# Where each piece comes from is the point. The engine is the published one the
# flake pins, because building Chromium is four hours and a shell author is not
# doing that. The compositor and the bridge come out of *this checkout*, built
# here, so a change to either is one restart away rather than a release.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHELL_NAME="${1:-}"
if [ -z "$SHELL_NAME" ]; then
  echo "usage: dev-shell.sh <shell>   e.g. dev-shell.sh manganese" >&2
  exit 2
fi
SHELL_DIR="$ROOT/packages/shell-$SHELL_NAME"
[ -d "$SHELL_DIR" ] || {
  echo "no shell '$SHELL_NAME' — there is no packages/shell-$SHELL_NAME." >&2
  exit 1
}
# Where the shell's own renderer config puts it: this runs the shell's own
# build rather than a second one of ours.
PAGE_DIR="$SHELL_DIR/.vite/renderer/main_window"

# THE FIRST BUILD IS NOT THE WATCHER'S. `build:vite` depends on `^prepare` and
# `^build`, and on a fresh checkout neither has run: `styled-system/` is
# generated and gitignored, and the workspace packages a shell imports are
# published from `dist/`. A bare `vite build --watch` in the shell's directory
# would build a page with no SDK in it, which is a desktop whose shell never
# joins the compositor.
echo "building $SHELL_NAME"
(cd "$ROOT" && bun install --frozen-lockfile >/dev/null &&
   CI=1 bun run turbo build:vite --filter="@domicile/shell-$SHELL_NAME") || {
  echo "the shell did not build" >&2
  exit 1
}

# A directory of this run's own, for the one file this has to write.
WORK="$(mktemp -d)"
WATCHING=()
cleanup() {
  if [ ${#WATCHING[@]} -gt 0 ]; then
    kill "${WATCHING[@]}" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# Now the watcher, on the shell alone. Its dependencies were built above and a
# change to one of them is a restart — this is the loop for working on a shell,
# not on the SDK underneath it.
echo "watching $SHELL_DIR"
(cd "$SHELL_DIR" && exec bunx vite build -c vite.renderer.config.ts --watch) &
WATCHING+=($!)

# The engine: the published one, fetched and pinned by the flake, because the
# alternative is a four-hour Chromium build. `DOMICILE_ENGINE` overrides it for
# somebody who has one already — the engine agent's own `out/Agent`, say — and
# that is the whole of what `nix` is used for here.
ENGINE="${DOMICILE_ENGINE:-}"
if [ -z "$ENGINE" ]; then
  command -v nix >/dev/null 2>&1 || {
    echo "no nix on PATH, so there is no engine to run this in. Either install" >&2
    echo "  nix, or point DOMICILE_ENGINE at an engine you have already:" >&2
    echo "    DOMICILE_ENGINE=/build/chromium/src/out/Domicile $0 $SHELL_NAME" >&2
    exit 1
  }
  echo "fetching the pinned engine"
  ENGINE="$(nix build --no-link --print-out-paths "$ROOT#engine")" || {
    echo "the engine would not build. \`nix build .#engine\` says why." >&2
    exit 1
  }
fi

# `domicile` builds nothing — that is the point of it — so the two components
# that come out of *this checkout* are built here, which is what running a
# shell from a checkout is for. The engine is the published one either way: a
# four-hour Chromium build is not a dev loop.
echo "building the compositor and the runner"
cargo build -p domicile-launch --bin domicile \
            -p domicile-compositor --bin domicile-compositor || exit 1

# The bridge as something that runs. A packaged desktop ships it compiled, with
# the runtime embedded, because an end user has no `bun`. A checkout has one,
# and a three-line shim starts instantly where `--compile` writes a hundred
# megabytes on every save.
BRIDGE="$WORK/domicile-bridge"
cat >"$BRIDGE" <<SHIM
#!/bin/sh
exec bun "$ROOT/packages/engine-chrome-host/src/main.ts" "\$@"
SHIM
chmod +x "$BRIDGE"

# `DOMICILE_DEV_RELOAD` is the only thing that separates this from an installed
# desktop: the bridge serves the reload token and writes the poller into the
# page, and nothing else in the repository sets it. It goes when `load-shell`
# arrives — see docs/architecture/THE-DOMICILE-BINARY.md.
echo "starting $SHELL_NAME"
DOMICILE_ENGINE="$ENGINE" \
DOMICILE_COMPOSITOR="$ROOT/target/debug/domicile-compositor" \
DOMICILE_BRIDGE="$BRIDGE" \
DOMICILE_PAGE="$PAGE_DIR" \
DOMICILE_DEV_RELOAD=1 \
  "$ROOT/target/debug/domicile" "$SHELL_NAME"
