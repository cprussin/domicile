#!/usr/bin/env bash
# Tests what `guard-shell.sh` accepts as a built shell and which switches it
# passes to the engine.
#
# A shell builds to one module, `shell.js`, with no document. `engine.yml`
# runs only on engine changes, so this test runs the guard's resolution on
# every push to catch a change in the shell's build output.
#
# Both blocks are read from the real script, as `test-dev-shell.sh` does with
# `dev-shell.sh`, so a stale copy cannot pass.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shell.sh"
# The real annotation helpers, since the guard's message is what is tested.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# From the module name to the `fi` that refuses when it is missing.
RESOLVE="$(awk '/^MODULE="\$PAGE_DIR\/shell.js"$/,/^fi$/' "$GUARD")"
# The chrome launch. Handing the engine a different path than the one
# resolved leaves the desktop blank with nothing in any log.
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

# Domicile writes the document, so a directory with only `index.html` is a
# wrong build and must be refused.
expect "a document alone is refused" \
  "refused: guard-shell: simple built no shell.js in $WORK/document" \
  "$(resolve "$WORK/document")"

expect "an empty directory is refused, in words that name what is missing" \
  "refused: guard-shell: simple built no shell.js in $WORK/nothing" \
  "$(resolve "$WORK/nothing")"

# The root and module switches. Passing the module as the root serves a
# directory with no module in it, and the desktop comes up blank.
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
    # A fake `chrome` that writes its arguments to the log.
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

# The bare root, because the engine serves its generated document there. A
# file path under it goes to the file resolver, which finds nothing.
expect "the desktop starts on the document the engine writes" \
  "--app=domicile://shell/" \
  "$(printf '%s\n' "$ARGS" | grep '^--app=')"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
