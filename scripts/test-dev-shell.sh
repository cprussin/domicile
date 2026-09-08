#!/usr/bin/env bash
# What dev mode hands the desktop, and what it refuses.
#
# `dev-shell.sh` is four decisions and three processes, and the decisions are
# the part worth testing: which page directory the desktop is told to serve,
# that dev mode is switched on, that a published engine is described as its own
# out directory, and that the compositor and the bridge are left unset so they
# come out of the checkout. Every one of those is invisible until a desktop
# starts, and three of the four fail as something else — a blank page, a
# desktop with no reload in it, a shell that never joins.
#
# The launch is run out of the real script rather than copied, with `nix` and
# `run-engine.sh` shadowed so nothing is fetched and no browser starts.
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
  (*DOMICILE_DEV_RELOAD*run-engine.sh*) ;;
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

# What the desktop was told, in the order a reader cares about it. `env` rather
# than a fixed list, so a variable that stops being passed shows up as a
# missing line instead of as nothing at all.
launch() { # $1 DOMICILE_ENGINE, $2 (optional) OUT
  (
    ROOT="$WORK/checkout"
    SHELL_NAME=simple
    PAGE_DIR="$WORK/page"
    DOMICILE_ENGINE="$1"
    OUT="${2:-}"
    [ -n "$OUT" ] || unset OUT
    # `nix` must not be reached for at all when an engine was handed in: a dev
    # loop that fetches something when it was told what to use is a dev loop
    # that needs a network.
    nix() { echo "nix $*" >>"$WORK/nix.log"; echo "$WORK/store-engine"; }
    command() { [ "${2:-}" = "nix" ] && return 0; builtin command "$@"; }
    mkdir -p "$ROOT/scripts"
    cat >"$ROOT/scripts/run-engine.sh" <<'STUB'
#!/usr/bin/env bash
echo "engine=$1"
echo "page=${DOMICILE_PAGE:-}"
echo "reload=${DOMICILE_DEV_RELOAD:-unset}"
echo "out=${OUT:-unset}"
echo "compositor=${DOMICILE_COMPOSITOR:-unset}"
echo "bridge=${DOMICILE_BRIDGE:-unset}"
STUB
    chmod +x "$ROOT/scripts/run-engine.sh"
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

expect "the desktop serves the page the watcher writes" \
  "page=$WORK/page" \
  "$(printf '%s\n' "$handed" | sed -n 's/^page=/page=/p')"

# A published engine *is* its out directory; a Chromium checkout has one under
# `out/Domicile`. Getting this wrong is "no engine at .../out/Domicile/chrome"
# against a store path that has a perfectly good chrome in it.
expect "a published engine is its own out directory" "out=." \
  "$(printf '%s\n' "$handed" | sed -n 's/^out=/out=/p')"

# Unset is an instruction, not a gap: `run-engine.sh` reads it as "build it out
# of this checkout", which is the whole reason to develop here rather than
# against a release.
expect "the compositor is left for the checkout to build" "compositor=unset" \
  "$(printf '%s\n' "$handed" | sed -n 's/^compositor=/compositor=/p')"
expect "the bridge is left for the checkout to build" "bridge=unset" \
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

# An override that also says which out directory — a Chromium checkout — keeps
# its own answer rather than being told it is a published tarball.
expect "a checkout handed in keeps its own out directory" "out=out/Domicile" \
  "$(printf '%s\n' "$(launch /build/chromium/src out/Domicile)" |
       sed -n 's/^out=/out=/p')"

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
