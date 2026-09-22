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
# So dev mode is the desktop now. The engine, the compositor and the shell,
# exactly as `nix run .#manganese` assembles them — with one difference, and it
# is there to make an edit cheap: the page is rebuilt on save, by the shell's
# own vite in watch mode, and the rebuilt module is handed to the desktop that
# is already running. `domicile load-shell <path>` is what does that and the
# desktop takes it without stopping, so the windows stay where they are and an
# edit costs a build rather than a restart. `dev-shell-reload.sh` is the half
# that waits for a build to finish and runs it; what is here is the two things
# it needs, which are the module to watch and the socket the desktop answers
# on. THE DESKTOP IS NOT RESTARTED ON A REBUILD, and never was: what used to
# restart it was the person at the keyboard, for want of this.
#
# Where each piece comes from is the point. The engine is the published one the
# flake pins, because building Chromium is four hours and a shell author is not
# doing that. The compositor and the runner come out of *this checkout*, built
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
# Where the shell's own vite config puts it: this runs the shell's own
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
(cd "$SHELL_DIR" && exec bunx vite build --watch) &
WATCHING+=($!)

# And what each of those builds is for. The loop waits for the socket file
# below before it does anything, so starting it here — before the binary it
# calls has been built — is starting it before it can run: by the time a
# desktop has printed a socket, the `cargo build` further down has long since
# produced the `domicile` that loop runs.
"$ROOT/scripts/dev-shell-reload.sh" \
  "$ROOT/target/debug/domicile" "$PAGE_DIR/shell.js" "$WORK/sock" &
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

# `DOMICILE_PAGE` names the module, because `domicile`'s argument does and the
# two are one rule: a directory is refused outright rather than searched for a
# name the launcher no longer knows. `shell.js` is what the shell's own vite
# config emits — `@domicile/component-library/vite-shell` pins the entry name
# so that something other than the shell can say it — so this is the one place
# in the dev loop that has to know the convention, and it says so.
#
# NOTHING SEPARATES THIS FROM AN INSTALLED DESKTOP ANY MORE.
# `DOMICILE_DEV_RELOAD` used to: the bridge read it, served a reload token and
# wrote a poller into the page. The bridge is gone and the C++ that writes the
# document has nothing in their place, so the variable switches nothing on and
# is not set here. What replaced it is a command every desktop takes rather
# than a mode this one is started in: `domicile load-shell ./path/to/shell.js`
# — see docs/architecture/THE-DOMICILE-BINARY.md.
#
# WHAT IT PRINTS IS READ AS IT GOES PAST, and that is the whole of how the
# reload loop finds the desktop. `domicile` puts `DOMICILE_SOCK` in the
# environment of what it spawns, and this script started it rather than the
# other way around, so nothing here inherits it; the supervisor also prints it,
# beside the shell and the config it chose, and reading that line is asking the
# thing that knows instead of keeping a second copy of
# `control_socket::address` in bash. The path is not written down until the
# desktop has said it is up, because the socket is bound before the engine
# starts and a shell loaded onto a desktop with no engine yet is a refusal
# nobody caused.
echo "starting $SHELL_NAME"
SOCK=""
DOMICILE_ENGINE="$ENGINE" \
DOMICILE_COMPOSITOR="$ROOT/target/debug/domicile-compositor" \
DOMICILE_PAGE="$PAGE_DIR/shell.js" \
  "$ROOT/target/debug/domicile" "$SHELL_NAME" | while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    (DOMICILE_SOCK=*) SOCK="${line#DOMICILE_SOCK=}" ;;
    ("domicile is up."*) printf '%s\n' "$SOCK" >"$WORK/sock" ;;
  esac
done
# The desktop's own status, not the reader's: a desk that would not come up
# exits non-zero, and a pipeline's last command is the one whose status a shell
# would otherwise report.
exit "${PIPESTATUS[0]}"
