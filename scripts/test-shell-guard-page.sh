#!/usr/bin/env bash
# What the shell guard will accept as a built shell, and what it tells the
# bridge it found.
#
# A shell in this workspace is one JavaScript module: `shellBuild` emits
# `shell.js` and no document, because Domicile writes the document. This guard
# went on requiring an `index.html` for a day after that stopped being true,
# and the failure was as cheap to read as it was invisible — "built no
# index.html", fourteen seconds, all three of its logs empty, on a pull request
# that had touched none of it.
#
# Nothing caught it because `engine.yml` runs only on
# `packages/domicile-engine/**`, and the change that made the shells emit a
# module touched the runner, `test-out-of-tree-shell.sh` and both shells —
# none of that path. So the two callers that were updated had no way to speak
# for the third. This test is that: it runs the guard's own resolution, so a
# shell whose shape changes again fails here, in a check that runs on every
# push, rather than on whatever engine pull request happens to be next.
#
# Both blocks are taken out of the real script rather than copied, as
# `test-dev-shell.sh` does with `dev-shell.sh`: a copy is a thing that passes
# while the script it stands for does not.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shell.sh"
# The real refusal, not a stub: what a guard says is the behaviour.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# The name it looks for, to the `fi` that refuses when it is not there.
RESOLVE="$(awk '/^MODULE="\$PAGE_DIR\/shell.js"$/,/^fi$/' "$GUARD")"
# The launch, which is the other half: finding the module and then telling the
# engine about a different one is the same failure as not finding it.
#
# It used to slice the bridge's start-up and read `DOMICILE_MODULE`. There is
# no bridge -- the engine serves the shell over `domicile://` now -- so it
# slices chrome's command line and reads the switches that say where the shell
# is. Same rule, and the same failure it exists to catch: a module handed over
# as a root serves a directory with no module in it, and the desktop comes up
# blank with nothing in any log to say why.
LAUNCH="$(awk '/^"\$CHROMIUM\/\$OUT\/chrome" \\$/,/^STARTED\+=\(\$!\)$/' "$GUARD")"
[ -n "$RESOLVE" ] && [ -n "$LAUNCH" ] || {
  echo "no page resolution in $GUARD — its markers moved. Fix this test with it." >&2
  exit 1
}
case "$RESOLVE" in
  (*shell.js*) ;;
  (*) echo "the resolution block no longer names shell.js." >&2; exit 1 ;;
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

# What a built shell is, and what is not one.
mkdir -p "$WORK/module" "$WORK/document" "$WORK/nothing"
: >"$WORK/module/shell.js"
: >"$WORK/document/index.html"

resolve() { # $1 the built directory
  local out
  if out="$( (
      SHELL_NAME=simple
      PAGE_DIR="$1"
      eval "$RESOLVE"
      echo "module=$MODULE"
    ) 2>&1 )"; then
    printf '%s\n' "$out"
  else
    printf 'refused: %s\n' "$(printf '%s\n' "$out" | sed -n 's/^::error:://p' | head -1)"
  fi
}

expect "a module is what a shell in this workspace builds" \
  "module=$WORK/module/shell.js" \
  "$(resolve "$WORK/module")"

# A document is not a shell. Domicile writes the document, so a directory with
# one and no module is a build that emitted the wrong thing — and it has to be
# refused rather than served, or the desktop comes up on someone's stray HTML.
expect "a document alone is refused" \
  "refused: guard-shell: simple built no shell.js in $WORK/document" \
  "$(resolve "$WORK/document")"

expect "an empty directory is refused, in words that name what is missing" \
  "refused: guard-shell: simple built no shell.js in $WORK/nothing" \
  "$(resolve "$WORK/nothing")"

# WHICH ONE THE BRIDGE IS TOLD, which is the half a resolution alone does not
# cover. The bridge refuses a shell named twice, so these are exclusive: a
# module handed over as a root serves a directory with no document in it, and
# the page comes up blank with nothing in any log to say why.
launch() { # $1 MODULE, $2 PAGE_DIR
  (
    MODULE="$1"
    PAGE_DIR="$2"
    COMP_SOCK="$WORK/sock"
    PROFILE="$WORK/profile"
    BROKER="$WORK/broker"
    ENGINE_LOG="$WORK/engine.log"
    WIDTH=800
    HEIGHT=600
    STARTED=()
    # A `chrome` that writes its own arguments where the real one writes its
    # log, so the launch is exercised without an engine.
    CHROMIUM="$WORK"
    OUT="bin"
    mkdir -p "$WORK/bin"
    printf '#!/bin/sh\nfor a in "$@"; do echo "$a"; done\n' >"$WORK/bin/chrome"
    chmod +x "$WORK/bin/chrome"
    : >"$ENGINE_LOG"
    eval "$LAUNCH"
    wait
    cat "$ENGINE_LOG"
  )
}

ARGS="$(launch "$WORK/module/shell.js" "$WORK/module")"

expect "the directory holding the module is what the engine serves" \
  "--domicile-shell-root=$WORK/module" \
  "$(printf '%s\n' "$ARGS" | grep '^--domicile-shell-root=')"

expect "the module is named relative to that root, not as a path" \
  "--domicile-shell-module=shell.js" \
  "$(printf '%s\n' "$ARGS" | grep '^--domicile-shell-module=')"

# The bare root, because the engine writes the document and serves it there.
# Asking for a file under it sends the request to the file resolver instead,
# which looks for something no build emits -- see `spawn.rs`, which had this
# wrong and produced exactly the blank window this guard exists to catch.
expect "the desktop starts on the document the engine writes" \
  "--app=domicile://shell/" \
  "$(printf '%s\n' "$ARGS" | grep '^--app=')"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
