#!/usr/bin/env bash
# What dev mode hands the desktop, and what it refuses.
#
# `dev-shell.sh` is four decisions and three processes, and the decisions are
# the part worth testing: which page directory the desktop is told to serve,
# that dev mode is switched on, and that the compositor and the bridge are the
# ones out of this checkout rather than whatever sits beside the binary. Every
# one of those is invisible until a desktop starts, and each fails as something
# else — a blank page, a desktop with no reload in it, a shell that never
# joins.
#
# The launch is run out of the real script rather than copied, with `nix`,
# `cargo` and `domicile` itself shadowed so nothing is fetched, nothing is
# built and no browser starts.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT/scripts/dev-shell.sh"
[ -x "$SCRIPT_UNDER_TEST" ] || { echo "no $SCRIPT_UNDER_TEST" >&2; exit 1; }

# From the engine resolution to the last line: the two blocks that decide
# anything, and nothing in between them but comments.
LAUNCH="$(awk '/^ENGINE="\$\{DOMICILE_ENGINE:-\}"$/,0' "$SCRIPT_UNDER_TEST")"
[ -n "$LAUNCH" ] || {
  echo "no launch in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}
case "$LAUNCH" in
  (*DOMICILE_DEV_RELOAD*target/debug/domicile*) ;;
  (*) echo "the launch block no longer starts a desktop." >&2; exit 1 ;;
esac

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CHECKOUT="$WORK/checkout"

# What the desktop was told, in the order a reader cares about it. `env` rather
# than a fixed list, so a variable that stops being passed shows up as a
# missing line instead of as nothing at all.
launch() { # $1 DOMICILE_ENGINE
  (
    ROOT="$CHECKOUT"
    SHELL_NAME=simple
    PAGE_DIR="$WORK/page"
    DOMICILE_ENGINE="$1"
    # `nix` must not be reached for at all when an engine was handed in: a dev
    # loop that fetches something when it was told what to use is a dev loop
    # that needs a network.
    nix() { echo "nix $*" >>"$WORK/nix.log"; echo "$WORK/store-engine"; }
    command() { [ "${2:-}" = "nix" ] && return 0; builtin command "$@"; }
    # `cargo` shadowed: the launch builds the two components out of the
    # checkout now, and this test is about what it hands over rather than
    # about cargo working.
    cargo() { echo "cargo $*" >>"$WORK/cargo.log"; }
    mkdir -p "$ROOT/target/debug"
    cat >"$ROOT/target/debug/domicile" <<'STUB'
#!/usr/bin/env bash
echo "shell=$1"
echo "engine=${DOMICILE_ENGINE:-unset}"
echo "page=${DOMICILE_PAGE:-}"
echo "reload=${DOMICILE_DEV_RELOAD:-unset}"
echo "compositor=${DOMICILE_COMPOSITOR:-unset}"
echo "bridge=${DOMICILE_BRIDGE:-unset}"
STUB
    chmod +x "$ROOT/target/debug/domicile"
    eval "$LAUNCH"
  ) 2>&1
}

: >"$WORK/nix.log"
handed="$(launch "$WORK/my-engine")"

expect "the engine handed in is the one that is run" \
  "engine=$WORK/my-engine" \
  "$(printf '%s\n' "$handed" | sed -n 's/^engine=/engine=/p')"

# THE ONE THAT SEPARATES THIS FROM AN INSTALLED DESKTOP. Without it the bridge
# serves no reload token and writes no poller, so the page never reloads — and
# a dev loop where every edit needs the desktop killed and restarted is the
# thing this script exists to replace. It would look like it worked.
expect "dev mode is switched on" "reload=1" \
  "$(printf '%s\n' "$handed" | sed -n 's/^reload=/reload=/p')"

# THE MODULE, NOT THE DIRECTORY HOLDING IT. `domicile` takes the file now, and
# it refuses a directory rather than looking inside one for a name it no longer
# knows — so a dev loop that handed over `$PAGE_DIR` would not start at all,
# and would say so about a path the script never printed. `shell.js` is the
# name the shell's own vite config pins, which is why this can join it on.
expect "the desktop is handed the module the watcher writes" \
  "page=$WORK/page/shell.js" \
  "$(printf '%s\n' "$handed" | sed -n 's/^page=/page=/p')"

# `domicile` builds nothing, so this script does — and hands over what it
# built. Unset here would be the desktop looking for components beside a
# binary in `target/debug`, where nobody installs anything.
expect "the compositor comes out of this checkout" \
  "compositor=$CHECKOUT/target/debug/domicile-compositor" \
  "$(printf '%s\n' "$handed" | sed -n 's/^compositor=/compositor=/p')"

# AND NO BRIDGE. The engine serves the shell itself over `domicile://` now, so
# there is no third process and nothing sets this. A dev loop that still handed
# one over would be starting a page server nothing reads.
expect "no bridge is handed over any more" "bridge=unset" \
  "$(printf '%s\n' "$handed" | sed -n 's/^bridge=/bridge=/p')"

expect "an engine that was handed in is not fetched again" "" \
  "$(cat "$WORK/nix.log")"

# And when nothing was handed in, the flake's pinned engine is what runs.
: >"$WORK/nix.log"
fetched="$(launch "")"
expect "the pinned engine is fetched when none was given" \
  "engine=$WORK/store-engine" \
  "$(printf '%s\n' "$fetched" | sed -n 's/^engine=/engine=/p')"
expect "and it is the flake's own engine that is built" "yes" \
  "$(grep -q '#engine' "$WORK/nix.log" && echo yes || echo no)"

# The refusals, out of the real script, because a message naming a shell that
# does not exist is the whole of what a typo gets you.
refuse() { "$SCRIPT_UNDER_TEST" "$@" 2>&1 | head -1; }
expect "a shell nobody named is refused with the usage" \
  "usage: dev-shell.sh <shell>   e.g. dev-shell.sh manganese" \
  "$(refuse)"
expect "a shell that does not exist is named in the refusal" \
  "no shell 'nonesuch' — there is no packages/shell-nonesuch." \
  "$(refuse nonesuch)"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
