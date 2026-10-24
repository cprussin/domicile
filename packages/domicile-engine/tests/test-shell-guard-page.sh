#!/usr/bin/env bash
# Tests what `guard-shell.sh` accepts as a built shell, what it hands
# `domicile`, and how it splits `domicile`'s output into its logs.
#
# A shell builds to one module, `shell.js`, with no document. `engine.yml`
# runs only on engine changes, so this test runs the guard's resolution on
# every push to catch a change in the shell's build output.
#
# Both blocks are read from the real script, as `test-dev-shell.sh` does with
# `dev-shell.sh`, so a stale copy cannot pass.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GUARD="$ROOT/packages/domicile-engine/scripts/guard-shell.sh"
# The real annotation helpers, since the guard's message is what is tested.
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$ROOT/packages/domicile-engine/scripts/lib-annotate.sh"

# From the module name to the `fi` that refuses when it is missing.
RESOLVE="$(awk '/^MODULE="\$PAGE_DIR\/shell.js"$/,/^fi$/' "$GUARD")"
# The launch through `domicile`, and the function that splits its output.
LAUNCH="$(awk '/^DOMICILE_ENGINE="\$CHROMIUM\/\$OUT" \\$/,/^STARTED\+=\("\$DOMICILE_PID"\)$/' "$GUARD")"
SPLIT="$(awk '/^split_the_run\(\) \{/,/^\}$/' "$GUARD")"
[ -n "$RESOLVE" ] && [ -n "$LAUNCH" ] && [ -n "$SPLIT" ] || {
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

# The launch. `domicile` turns the module into the engine's root and module
# switches, which `packages/domicile-launch/tests/spawn.rs` covers. Handing it
# a different path than the one resolved leaves the desktop blank with nothing
# in any log.
#
# A stub `domicile` writes what it was given to a file, then prints lines as
# each process writes them, so the split into the guard's logs is tested too.
launch() { # $1 MODULE
  (
    MODULE="$1"
    COLOR=19B36B
    CHROMIUM="$WORK/tree"
    OUT="out/Domicile"
    COMPOSITOR="$WORK/bin/domicile-compositor"
    DOMICILE="$WORK/bin/domicile"
    NO_CONFIG="$WORK/config"
    STATE="$WORK/state"
    RUN_LOG="$WORK/run.log"
    COMP_LOG="$WORK/comp.log"
    ENGINE_LOG="$WORK/engine.log"
    WIDTH=800
    HEIGHT=600
    STARTED=()
    mkdir -p "$WORK/bin" "$NO_CONFIG" "$STATE"
    export HANDED="$WORK/handed"
    cat >"$DOMICILE" <<'STUB'
#!/bin/sh
{
echo "shell=$*"
echo "engine=${DOMICILE_ENGINE:-unset}"
echo "compositor=${DOMICILE_COMPOSITOR:-unset}"
echo "ozone=${OZONE:-unset}"
echo "engine args=${DOMICILE_ENGINE_ARGS:-unset}"
echo "config home=${XDG_CONFIG_HOME:-unset}"
echo "state home=${XDG_STATE_HOME:-unset}"
echo "find=${DOMICILE_SPIKE_FIND:-unset}"
} >"$HANDED"
echo "domicile: the engine's broker socket is up" >&2
echo '2026-09-07T11:37:13.641032Z  INFO domicile_compositor: chrome agreed the protocol; it now gets the desktop'
echo 'domicile-compositor: no session' >&2
echo '[875919:875919:0907/043334.191180:INFO:external_surface_embedder.cc(100)] domicile: embedding "app-1"' >&2
STUB
    chmod +x "$DOMICILE"
    : >"$RUN_LOG"; : >"$COMP_LOG"; : >"$ENGINE_LOG"
    eval "$SPLIT"
    eval "$LAUNCH"
    # The split runs in a process substitution, which `wait` does not cover.
    for _ in $(seq 1 50); do
      [ "$(wc -l <"$RUN_LOG")" -ge 4 ] && break
      sleep 0.1
    done
  )
}

launch "$WORK/module/shell.js"
RUN="$(cat "$WORK/handed")"

expect "domicile is handed the module the guard resolved" \
  "shell=$WORK/module/shell.js" \
  "$(printf '%s\n' "$RUN" | grep '^shell=')"

expect "the engine is the build under test" \
  "engine=$WORK/tree/out/Domicile" \
  "$(printf '%s\n' "$RUN" | grep '^engine=')"

expect "the compositor is this checkout's" \
  "compositor=$WORK/bin/domicile-compositor" \
  "$(printf '%s\n' "$RUN" | grep '^compositor=')"

# The guard runs under `under-wayland.sh`'s sway, whose dmabuf import is what
# it tests.
expect "the engine runs nested" \
  "ozone=wayland" \
  "$(printf '%s\n' "$RUN" | grep '^ozone=')"

# An empty config home means compositor defaults, whatever the runner's user
# has configured.
expect "the runner's own config is not read" \
  "config home=$WORK/config" \
  "$(printf '%s\n' "$RUN" | grep '^config home=')"

expect "the profile is the guard's own" \
  "state home=$WORK/state" \
  "$(printf '%s\n' "$RUN" | grep '^state home=')"

expect "the compositor searches for the client's color" \
  "find=19B36B" \
  "$(printf '%s\n' "$RUN" | grep '^find=')"

# `--log-level=0` for the renderer's `domicile: embedding`, which is INFO.
# `--disable-component-update`: see `packages/domicile-engine/docs/GUARDS.md`.
for flag in --no-sandbox --disable-component-update --log-level=0 --window-size=800,600; do
  expect "the engine gets $flag" yes \
    "$(printf '%s\n' "$RUN" | sed -n 's/^engine args=//p' | tr ' ' '\n' | grep -qxF -- "$flag" && echo yes || echo no)"
done

expect "the compositor's lines are the compositor log" \
  "2026-09-07T11:37:13.641032Z  INFO domicile_compositor: chrome agreed the protocol; it now gets the desktop
domicile-compositor: no session" \
  "$(cat "$WORK/comp.log")"

# The supervisor's own lines stay out, so a grep for `domicile:` in the engine
# log finds only the engine's.
expect "the engine's lines are the engine log" \
  '[875919:875919:0907/043334.191180:INFO:external_surface_embedder.cc(100)] domicile: embedding "app-1"' \
  "$(cat "$WORK/engine.log")"

expect "every line is in the run log" 4 "$(wc -l <"$WORK/run.log" | tr -d ' ')"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
