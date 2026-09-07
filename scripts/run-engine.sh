#!/usr/bin/env bash
# Run a Domicile desktop on the forked engine, with no Electron anywhere.
#
#   nix develop .#full -c ./scripts/run-engine.sh /build/chromium/src
#   nix develop .#full -c ./scripts/run-engine.sh /build/chromium/src simple
#
# The browser is the display compositor: the shell's page embeds each client's
# surface into its own layer tree, and the compositor is a producer rather than
# a renderer. That is the whole point of the fork -- see
# docs/architecture/ENGINE-FORK.md.
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
SHELL_ARG="${2:-simple}"
# THIRD AND LATER ARGUMENTS ARE REFUSED, because there is nothing for them to
# mean and the flake hands this a shell name of its own. `nix run
# github:cprussin/domicile -- simple` reaches here as `<engine> manganese
# simple`: the desktop is already chosen by which app was run, and quietly
# dropping the word somebody typed hands them manganese while they read the
# word simple on their own command line.
if [ "$#" -gt 2 ]; then
  echo "run-engine.sh: too many arguments. Which desktop is chosen by which" >&2
  echo "  app you run — \`nix run github:cprussin/domicile#simple\` rather" >&2
  echo "  than passing \`simple\` to another one. From a checkout it is the" >&2
  echo "  second argument and there is no third." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# THREE THINGS THIS NEEDS, AND TWO WAYS TO HAVE EACH. A checkout builds them —
# turbo for the page, cargo for the compositor, the workspace's own source for
# the bridge — and that is what a developer with this repo open wants. A
# package has them built already, in the store, and building anything at
# startup would be both slower and a second way to produce them.
#
# So each is a path that can be handed in, and the checkout's own build is what
# happens when it is not. Nothing here is a fallback: an unset variable means
# "build it", which is a different instruction rather than a recovery from a
# failure to find something.
PAGE_DIR="${DOMICILE_PAGE:-}"
COMPOSITOR="${DOMICILE_COMPOSITOR:-}"
BRIDGE="${DOMICILE_BRIDGE:-}"

# A shell is named or it is a path. `simple` is a shell in this workspace;
# `./my-desktop/dist` is somebody else's, built however they like, and the only
# thing this needs from it is a directory with an `index.html` in it. A file is
# taken as one in that directory, so pointing at a built entry point works as
# well as pointing at what contains it.
#
# A BARE NAME THAT IS ALSO A DIRECTORY IS A PATH. `run-engine.sh . dist` from
# inside a shell's source tree used to be refused with "there is no
# packages/shell-dist, and it is not a path to a built one either" — the second
# half of which was false, and the check that would have known it was never
# run. A directory here is what somebody meant.
#
# UNLESS A PAGE WAS HANDED IN, in which case a bare name is a name and nothing
# else. A packaged desktop sets `DOMICILE_PAGE` to the page it built and passes
# its own name along for the log — so `nix run github:cprussin/domicile#simple`
# reaches here as `<engine> simple` with a page already set. Run from a
# directory that happens to contain a `simple/`, that word became a path, and
# the refusal below fired about two instructions that disagree — naming a
# variable the user never set and a directory they were not talking about, from
# a command with no path in it at all. The user's own `cd` is not an argument.
#
# A name with a slash in it is still a path even then: `DOMICILE_PAGE` and
# `./somewhere/dist` really are two answers to one question, and that is the
# case the refusal was written for.
SHELL_NAME="$SHELL_ARG"
IS_PATH=no
case "$SHELL_ARG" in
  (*/*|.|..) IS_PATH=yes ;;
  (*) [ -z "$PAGE_DIR" ] && [ -d "$SHELL_ARG" ] && IS_PATH=yes ;;
esac

if [ "$IS_PATH" = yes ]; then
  # TWO INSTRUCTIONS THAT DISAGREE. A handed-in page and a path argument are
  # both somebody saying which page to serve, and the first version validated
  # the argument and then discarded it — so a run could fail because a path it
  # was never going to use did not exist, and succeed while serving a different
  # page than the one typed. Neither reading is safe to pick.
  if [ -n "$PAGE_DIR" ]; then
    echo "run-engine.sh: given both a page and a path to one, and they are" >&2
    echo "  not the same instruction:" >&2
    echo "    DOMICILE_PAGE=$PAGE_DIR" >&2
    echo "    the argument   $SHELL_ARG" >&2
    echo "  Pass one." >&2
    exit 1
  fi
  if [ -f "$SHELL_ARG" ]; then
    WHERE="$(dirname "$SHELL_ARG")"
  elif [ -d "$SHELL_ARG" ]; then
    WHERE="$SHELL_ARG"
  else
    echo "no shell at '$SHELL_ARG' — it is neither a file nor a directory." >&2
    exit 1
  fi
  # Checked, because `$(cd … && pwd)` swallows a failure into the empty string
  # and `set -u` then reports an unbound variable three steps later, about a
  # directory that exists and cannot be read.
  PAGE_DIR="$(cd "$WHERE" && pwd)" || {
    echo "cannot read '$WHERE', so there is no page to serve from it." >&2
    exit 1
  }
  [ -n "$PAGE_DIR" ] || {
    echo "cannot read '$WHERE', so there is no page to serve from it." >&2
    exit 1
  }
  SHELL_NAME="$(basename "$PAGE_DIR")"
elif [ -z "$PAGE_DIR" ]; then
  SHELL_DIR="$ROOT/packages/shell-$SHELL_NAME"
  [ -d "$SHELL_DIR" ] || {
    echo "no shell '$SHELL_NAME' — there is no packages/shell-$SHELL_NAME," >&2
    echo "  and there is no directory of that name here either." >&2
    exit 1
  }
fi

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
# filtered to this one, which is how every other script that builds a
# workspace shell does it. Nothing here is a second way to build a shell.
#
# `CI=1` because turbo's `//#build:install-modules` runs a non-frozen
# `bun install` without it. It does not close the other half: that task
# declares `bun.lock` an output, so a cache hit restores a lockfile over the
# tree's regardless. That belongs in `turbo.json`.
#
# Not just this package's vite: `build:vite` depends on `^prepare` and
# `^build`, and both are needed on a checkout where nothing has been built.
# `styled-system/` is generated and gitignored, and the workspace packages a
# shell imports are published from `dist/` — `@domicile/chrome-sdk`'s exports
# map every entry point to `./dist/*.js`, so without it the page builds
# without the SDK in it and the shell never joins the compositor.
if [ -z "$PAGE_DIR" ]; then
  echo "building $SHELL_NAME's page"
  (cd "$ROOT" && bun install --frozen-lockfile >/dev/null &&
     CI=1 bun run turbo build:vite --filter="@domicile/shell-$SHELL_NAME") || {
    echo "the shell's page did not build" >&2
    exit 1
  }
  # Where the shell's own renderer config puts it. `main_window` is what the
  # shell's `vite.renderer.config.ts` names the one window it opens, and it
  # stays that here rather than being special-cased: this runs the shell's
  # build, not a second one of our own.
  PAGE_DIR="$SHELL_DIR/.vite/renderer/main_window"
fi
[ -f "$PAGE_DIR/index.html" ] || {
  echo "no index.html in $PAGE_DIR, so there is no page to serve. A shell is a" >&2
  echo "  built web page: a directory with an index.html and whatever it loads." >&2
  exit 1
}

if [ -z "$COMPOSITOR" ]; then
  cargo build -p domicile-compositor || exit 1
  COMPOSITOR="$ROOT/target/debug/domicile-compositor"
fi
[ -f "$COMPOSITOR" ] && [ -x "$COMPOSITOR" ] || {
  echo "no compositor at $COMPOSITOR" >&2
  exit 1
}

BRIDGE="${BRIDGE:-$ROOT/packages/engine-chrome-host/src/main.ts}"
[ -f "$BRIDGE" ] || {
  echo "no bridge at $BRIDGE" >&2
  exit 1
}

rm -f "$BROKER" "$COMP_SOCK" "$COMP_SOCK.session"
rm -rf "$PROFILE"; mkdir -p "$PROFILE"

# 1. The bridge. It tolerates a compositor that is not there yet, which it
#    will not be for another second or so.
echo "serving $SHELL_NAME from $PAGE_DIR"
BRIDGE_URL_FILE="$(mktemp)"
DOMICILE_SOCKET="$COMP_SOCK" DOMICILE_ROOT="$PAGE_DIR" \
  bun "$BRIDGE" >"$BRIDGE_URL_FILE" 2>&1 &
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

# WHERE IT WAS STARTED DECIDES WHAT IT IS — for the one case that works today.
# The engine is built with `wayland` and `headless` and nothing else, so a
# desktop is a window inside an existing Wayland session, and the two other
# ways to start one are refused rather than attempted.
#
# `ozone_platform_drm` is what would make a tty the whole screen, and it cannot
# be set at this Chromium pin: `ui/ozone/platform/drm/BUILD.gn` opens with
# `assert(is_chromeos, "Ozone DRM platform is ChromeOS-only")`, and `//ui/ozone`
# depends on it the moment the argument is true, so `gn gen` refuses before
# anything compiles. Measured, run 34152521286;
# `docs/architecture/ENGINE-FORK.md` carries it. Handing `--ozone-platform=drm`
# to a binary with no drm platform in it is a black screen and a Chromium
# fatal, so this says the true thing instead.
#
# `WAYLAND_DISPLAY` is the question for the case that does work: it is what a
# Wayland client uses to find its compositor, so unset means there is nothing
# to be a window inside of. `OZONE` overrides everything — `headless` is a real
# answer on a machine with no display and no environment variable says so, and
# somebody trying the tty once it is patched should not have to edit this file.
if [ -n "${OZONE:-}" ]; then
  PLATFORM="$OZONE"
elif [ -n "${WAYLAND_DISPLAY:-}" ]; then
  PLATFORM=wayland
elif [ -n "${DISPLAY:-}" ]; then
  echo "run-engine.sh: this is an X11 session, and this engine has no x11" >&2
  echo "  platform — it is built for wayland and headless. Start it from a" >&2
  echo "  Wayland session for a window; OZONE=headless runs it with no" >&2
  echo "  display at all." >&2
  exit 1
else
  echo "run-engine.sh: there is no display server here, and a tty needs the" >&2
  echo "  drm ozone platform, which cannot be built at this Chromium pin —" >&2
  echo "  see docs/architecture/ENGINE-FORK.md. Start this from a Wayland" >&2
  echo "  session for a window; OZONE=headless runs it with no display." >&2
  exit 1
fi
echo "the engine is taking the $PLATFORM platform"

# 2. The engine, on that page.
#
# `--app` because a desktop is not a browser looking at a page. Without it the
# window carries a tab strip, an address bar and a bookmarks row — about 146
# pixels of somebody else's chrome above the shell's own, which
# `spike-step4.sh` reports as "page starts at y=146" and a user would call
# broken. It also drops the browser's own keyboard shortcuts, which a shell has
# to be able to bind.
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform="$PLATFORM" \
  --app="$URL" \
  --no-sandbox --password-store=basic --no-first-run \
  --user-data-dir="$PROFILE" \
  --enable-blink-features=DomicileExternalSurface \
  --domicile-broker-socket="$BROKER" &
STARTED+=($!)

for _ in $(seq 1 300); do [ -S "$BROKER" ] && break; sleep 0.1; done
[ -S "$BROKER" ] || {
  echo "the engine never opened its broker socket at $BROKER" >&2
  exit 1
}

# 3. The compositor, as a producer to it.
LD_LIBRARY_PATH="$CHROMIUM/$OUT${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
RUST_LOG="${RUST_LOG:-info,domicile_compositor=debug}" \
  "$COMPOSITOR" \
    --chrome-socket "$COMP_SOCK" \
    --session "$COMP_SOCK.session" \
    --engine-socket "$BROKER" &
COMP=$!
STARTED+=("$COMP")

echo
echo "domicile is up. Apps connect to the WAYLAND_DISPLAY the compositor names above."
echo "Ctrl-C to stop."
wait "$COMP"
