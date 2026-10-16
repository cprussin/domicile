#!/usr/bin/env bash
# A shell whose renderer crashes ends the engine, loudly: it exits abnormally
# with a FATAL line saying the shell's renderer died, that this is a bug in
# Domicile, and why.
#
#   nix develop .#full --command \
#     ./packages/domicile-engine/scripts/guard-shell-crash.sh /build/chromium/src
#
# Headless. It crashes the shell's renderer over the debugging port
# (guard-shell-crash-drive.py) and reads the engine's exit and log.
#
# Why: the shell's renderer dies only through a bug in Domicile. Chrome's sad
# tab would cover for it and leave a desktop that looks broken for no stated
# reason. Patch 0124 has SadTabHelper hand the page to
# `domicile::DieIfTheShellDied`, which LOG(FATAL)s; the binary's supervisor
# starts a new engine.
#
# Asserted:
#
#   the shell page ran          or nothing was set up
#   the engine exited           with a nonzero status, after the crash
#   the FATAL line              names the shell, the bug and "crashed"
#
# Control: NEGATIVE=1 crashes nothing. The engine must still be running, with
# no FATAL line, so the claim's death is the crash's doing.
set -u

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=packages/domicile-engine/scripts/lib-annotate.sh
. "$SCRIPTS/lib-annotate.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-control-budget.sh
. "$SCRIPTS/lib-control-budget.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$SCRIPTS/lib-last-words.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-ports.sh
. "$SCRIPTS/lib-ports.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$SCRIPTS/lib-profile.sh"
# shellcheck source=packages/domicile-engine/scripts/lib-broker.sh
. "$SCRIPTS/lib-broker.sh"

CHROMIUM="${1:-}"
if [ -z "$CHROMIUM" ]; then
  annotate "guard-shell-crash: no path to chromium/src was given"
  exit 1
fi

# NEGATIVE=1 crashes nothing. See the header.
NEGATIVE="${NEGATIVE:-0}"
MODE="crash"
[ "$NEGATIVE" = "1" ] && MODE="still"

OUT="${OUT:-out/Domicile}"
WHICH=""
[ "$NEGATIVE" = "1" ] && WHICH="-negative"
BROKER="${BROKER:-/tmp/domicile-shell-crash$WHICH-broker}"
PROFILE="${PROFILE:-/tmp/domicile-shell-crash$WHICH-profile}"
ENGINE_LOG="${ENGINE_LOG:-/tmp/domicile-shell-crash$WHICH-engine.log}"
DRIVE_LOG="${DRIVE_LOG:-/tmp/domicile-shell-crash$WHICH-drive.log}"
FOR_SECONDS="${FOR_SECONDS:-90}"

# The engine's last line for a dead shell. See ShellDeathMessage.
FATAL_LINE="the Domicile shell's renderer died (crashed, exit code"
BUG_LINE="This is a bug in Domicile"

ENGINE=""
cleanup() {
  [ -n "$ENGINE" ] && kill "$ENGINE" 2>/dev/null
  remove_profile "$PROFILE"
}
trap cleanup EXIT

[ -x "$CHROMIUM/$OUT/chrome" ] || {
  annotate "guard-shell-crash: no engine at $CHROMIUM/$OUT/chrome; build it with ./packages/domicile-engine/scripts/build.sh"
  exit 1
}
command -v python3 >/dev/null || {
  skip "guard-shell-crash: no python3, which crashes the shell"
  exit 77
}

fresh_broker; rm -rf "$PROFILE"; mkdir -p "$PROFILE"

wait_for_line() { # $1 tries, $2 pattern, $3 file
  for _ in $(seq 1 "$1"); do
    grep -aqF -- "$2" "$3" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

rm -f "$ENGINE_LOG"
"$CHROMIUM/$OUT/chrome" \
  --ozone-platform=headless \
  --disable-gpu \
  --window-size=800,600 \
  --app="domicile://shell/" \
  --domicile-shell-root="$SCRIPTS" \
  --domicile-shell-module="guard-shell-crash.js" \
  --remote-debugging-port=0 \
  --no-sandbox --password-store=basic --no-first-run --disable-component-update \
  --user-data-dir="$PROFILE" \
  --enable-logging=stderr --log-level=0 \
  --domicile-broker-socket="$BROKER" >"$ENGINE_LOG" 2>&1 &
ENGINE=$!

TRIES=$((FOR_SECONDS * 4))
wait_for_line "$TRIES" "GUARD shell-loaded" "$ENGINE_LOG" ||
  echo "the shell page never ran; the verdict below says what that means" >&2
DEBUG_PORT="$(devtools_port "$PROFILE" "$TRIES")" || {
  annotate_from "guard-shell-crash: the engine never said which debugging port it took" "$ENGINE_LOG"
  exit 1
}

rm -f "$DRIVE_LOG"
if [ "$MODE" = "crash" ]; then
  python3 "$SCRIPTS/guard-shell-crash-drive.py" --port "$DEBUG_PORT" \
    >>"$DRIVE_LOG" 2>&1 || echo "the shell could not be crashed; see $DRIVE_LOG" >&2
  LOOKS="$FOR_SECONDS"
else
  # The control waits for a death that must not come. See
  # lib-control-budget.sh.
  LOOKS="$(budget_for shell-crash "$FOR_SECONDS")"
fi

# Whether the engine is gone, polled each second.
WAITED=0
for _ in $(seq 1 "$LOOKS"); do
  kill -0 "$ENGINE" 2>/dev/null || break
  sleep 1
  WAITED=$((WAITED + 1))
done

DIED=0
STATUS="running"
if ! kill -0 "$ENGINE" 2>/dev/null; then
  wait "$ENGINE"
  STATUS=$?
  ENGINE=""
  [ "$STATUS" -ne 0 ] && DIED=1
fi
FATAL=0
grep -aF -- "$FATAL_LINE" "$ENGINE_LOG" 2>/dev/null | grep -aqF -- "$BUG_LINE" &&
  grep -aF -- "$FATAL_LINE" "$ENGINE_LOG" | grep -aq "FATAL" && FATAL=1
SAW_SHELL=0
grep -aqF "GUARD shell-loaded" "$ENGINE_LOG" && SAW_SHELL=1

if [ "$MODE" = "crash" ] && [ "$DIED" = "1" ]; then
  budget_note shell-crash "$WAITED"
fi

MEASURED="$MODE $SAW_SHELL $DIED $FATAL"
echo
echo "measured: $MEASURED (engine $STATUS)"
echo "  (mode shell died fatal)"

FAILURE=""
PASSED=""
case "$MEASURED" in
"crash 1 1 1")
  PASSED="a crashed shell ended the engine with status $STATUS and a FATAL \
line saying the shell's renderer died and that this is a bug in Domicile"
  ;;
"still 1 0 0")
  PASSED="the control is sharp: a shell left alone kept the engine running \
with no FATAL line, so the claim's death is the crash's doing"
  ;;
"crash 0 "* | "still 0 "*)
  FAILURE="the shell page never ran, so nothing here was set up: the module \
did not load, or it threw, and the engine log has its console"
  ;;
"crash 1 0 "*)
  FAILURE="THE SHELL CRASHED AND THE ENGINE KEPT RUNNING: SadTabHelper did not \
hand the page to DieIfTheShellDied (patch 0124), or the crash never landed \
($DRIVE_LOG)"
  ;;
"crash 1 1 0")
  FAILURE="the engine died, but not with the shell's FATAL line: it died of \
something else, or ShellDeathMessage no longer says what this guard reads \
($FATAL_LINE ... $BUG_LINE)"
  ;;
"still 1 1 "*)
  FAILURE="the engine died when nothing was crashed (status $STATUS), so \
this guard cannot tell the shell's death from any other"
  ;;
*)
  FAILURE="there is no measurement here this guard can place ($MEASURED)"
  ;;
esac

if [ -n "$PASSED" ]; then
  echo "PASS: $PASSED"
  exit 0
fi

annotate_from "guard-shell-crash: $FAILURE" "$ENGINE_LOG"
echo "what the driver saw:" >&2
cat "$DRIVE_LOG" >&2 2>/dev/null
echo "the engine's last words:" >&2
last_words "$ENGINE_LOG" >&2
exit 1
