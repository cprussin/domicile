#!/usr/bin/env bash
# Prints the logs of a failed engine run, most useful summary last.
#
# A separate script because GitHub echoes an inline `run:` block into the log,
# which would bury the failure under the script's source.
set -u

# shellcheck source=packages/domicile-engine/scripts/lib-last-words.sh
. "$(dirname "$0")/../../packages/domicile-engine/scripts/lib-last-words.sh"

# Where the guards and `check.sh` write. A test points it elsewhere.
LOGS="${DOMICILE_DIAGNOSTICS_LOGS:-/tmp}"

# A glob covers each guard's log and its negative control's `-negative` log
# without a list to update.
for log in "$LOGS"/domicile-under-wayland.log \
           "$LOGS"/domicile-*-compositor.log \
           "$LOGS"/domicile-*-bridge.log; do
  [ -f "$log" ] || continue
  echo "::group::$log"
  grep -aE 'app_appeared|brokered a frame sink|configure ->|first frame|engine drew|engine found|has not drawn|could not read the window|agreed the protocol|never released|refused|latency|FATAL|ERROR|WARN|panic' \
    "$log" | tail -40 || true
  echo "--- last 10 lines:"
  tail -10 "$log" 2>&1 | cut -c1-300 || true
  echo "::endgroup::"
done

# Engine logs. `domicile:` matches both the page's console lines and the
# embedder's, so embeds and browser errors appear together.
for log in "$LOGS"/domicile-*-engine.log; do
  [ -f "$log" ] || continue
  echo "::group::$log"
  grep -aE 'domicile:|CONSOLE|:FATAL:|ERROR:' "$log" | cut -c1-300 | tail -40 || true
  # Uncut: the stack frames under the fatal line name the failed check.
  crash="$(crash_of "$log")"
  if [ -n "$crash" ]; then
    echo "--- the crash:"
    echo "$crash"
  fi
  echo "--- last 10 lines:"
  tail -10 "$log" 2>&1 | cut -c1-300 || true
  echo "::endgroup::"
done

echo "the render node:"
ls -l /dev/dri 2>&1 | sed 's/^/  /' || true

# Summaries go last because a failed job's log is read from the end.
echo "counts, per log:"
for log in "$LOGS"/domicile-*-compositor.log; do
  [ -f "$log" ] || continue
  printf '  %-42s appeared=%s brokered=%s configured=%s drew=%s stuck=%s\n' \
    "$(basename "$log")" \
    "$(grep -ac 'app_appeared' "$log" || true)" \
    "$(grep -ac 'brokered a frame sink' "$log" || true)" \
    "$(grep -ac 'configure ->' "$log" || true)" \
    "$(grep -ac 'engine drew' "$log" || true)" \
    "$(grep -ac 'never released' "$log" || true)"
done

# The embedder logs the app id and the SurfaceId it got, not the element.
# Deduplicated per file so a negative control's embeds stay apart from the run
# that failed.
echo "which app embedded which surface:"
for log in "$LOGS"/domicile-*-engine.log; do
  [ -f "$log" ] || continue
  grep -ahoE 'domicile: (embedded|embedding|no surface for) .*' "$log" 2>/dev/null |
    cut -c1-200 | sort -u | sed "s|^|  $(basename "$log"): |" || true
done

# A window shows nothing until it commits a buffer the engine accepts, even
# after it maps, gets a frame sink and is configured.
echo "whose frames the engine took:"
sed 's/\x1b\[[0-9;]*m//g' "$LOGS"/domicile-*-compositor.log 2>/dev/null |
  grep -a "first frame" | sed 's/.*the engine took/  the engine took/' |
  cut -c1-200 | sort -u || true

# The probe's three answers: color found, color not drawn, window unreadable.
# Per file, because a run and its negative control expect opposite answers.
echo "what was looked for and found, if anything:"
for log in "$LOGS"/domicile-*-compositor.log; do
  [ -f "$log" ] || continue
  sed 's/\x1b\[[0-9;]*m//g' "$log" 2>/dev/null |
    grep -aoE 'engine (found|has not drawn|could not read the window at all looking for) #[0-9A-F]{8}.*' | cut -c1-200 |
    sort -u | sed "s|^|  $(basename "$log"): |" || true
done

# The latency guard's measurements. Per file, so the negative control (which
# measures nothing) is not mixed with the run.
echo "what a keystroke cost, if it was measured:"
for log in "$LOGS"/domicile-*-compositor.log; do
  [ -f "$log" ] || continue
  # Capped because `press_went_nowhere` warns once per round and would bury
  # the measurements.
  sed 's/\x1b\[[0-9;]*m//g' "$log" 2>/dev/null |
    grep -aE 'latency( |:)' | tail -20 | cut -c1-200 |
    sed "s|^|  $(basename "$log"): |" || true
done

echo "what was drawn, if anything:"
for log in "$LOGS"/domicile-*-compositor.log; do
  [ -f "$log" ] || continue
  grep -ahoE 'engine drew #[0-9A-F]{8}( at \([0-9]+,[0-9]+\))?' "$log" 2>/dev/null |
    sort -u | sed "s|^|  $(basename "$log"): |" || true
done

echo "what was complained about:"
sed 's/\x1b\[[0-9;]*m//g' "$LOGS"/domicile-*-compositor.log 2>/dev/null |
  grep -aoE '(WARN|ERROR) .*' | cut -c1-200 | sort | uniq -c |
  sort -rn | head -20 | sed 's/^/  /' || true

# A probe stopped by a capture the browser never answered says so in a fatal
# line above its stack.
echo "what each probe said last:"
for log in "$LOGS"/domicile-*-probe.log; do
  [ -f "$log" ] || continue
  echo "  $(basename "$log"):"
  { grep -aE -m1 "$DOMICILE_CRASH_START" "$log"; tail -5 "$log"; } |
    cut -c1-300 | sed 's/^/    /' || true
done

# Last: each failed check's own log, kept by `check.sh`. A check killed by its
# timeout writes no annotation, so this is where it says what it waited on.
# Its `::error::` lines are shown as text, since `check.sh` raised them already.
echo "what each failed check said last:"
for log in "$LOGS"/domicile-check-logs/*.log; do
  [ -f "$log" ] || continue
  echo "  $(basename "$log" .log):"
  tail -30 "$log" | cut -c1-300 | sed 's/^::error::/error: /; s/^/    /' || true
done
