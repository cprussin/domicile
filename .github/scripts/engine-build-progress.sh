#!/usr/bin/env bash
# Say how far a Chromium build has got, from siso's lines in its log.
#
#   .github/scripts/engine-build-progress.sh /tmp/domicile-shell.log
#   .github/scripts/engine-build-progress.sh --every 600 /tmp/domicile-shell.log
#
# CI prints the build's log only once the build ends. `--every` prints a line
# each period until it is killed. The first line waits a period, by when
# nix-shell has truncated the last build's log.
#
# siso prints `[finished/total] elapsed ...` for each step. Both counts and the
# time restart when engine-yielding-build.sh restarts the build, so the rate is
# the restarted build's own.
set -euo pipefail

# siso's elapsed time, such as `1h02m03.50s` or `9.80s`, in whole seconds.
seconds() {
  local t="$1" n=0
  [[ "$t" =~ ([0-9]+)h ]] && n=$((n + BASH_REMATCH[1] * 3600))
  [[ "$t" =~ ([0-9]+)m ]] && n=$((n + 10#${BASH_REMATCH[1]} * 60))
  [[ "$t" =~ ([0-9]+)(\.[0-9]+)?s$ ]] && n=$((n + 10#${BASH_REMATCH[1]}))
  echo "$n"
}

duration() {
  local n="$1"
  if [ "$n" -ge 3600 ]; then
    printf '%dh%02dm%02ds' $((n / 3600)) $((n % 3600 / 60)) $((n % 60))
  else
    printf '%dm%02ds' $((n / 60)) $((n % 60))
  fi
}

report() { # log
  # nix-shell creates the log, after the watcher starts.
  if [ ! -e "$1" ]; then
    echo "build progress: no step has finished yet"
    return
  fi
  # grep exits 1 when no step has been printed yet.
  local step
  step="$(grep -aoE '^\[[0-9]+/[0-9]+\] [0-9hms.]+' "$1" | tail -1)" || true
  if [[ ! "$step" =~ ^\[([0-9]+)/([0-9]+)\]\ (.*)$ ]] || [ "${BASH_REMATCH[1]}" -eq 0 ]; then
    echo "build progress: no step has finished yet"
    return
  fi
  local done="${BASH_REMATCH[1]}" total="${BASH_REMATCH[2]}"
  local took
  took="$(seconds "${BASH_REMATCH[3]}")"
  echo "build progress: $done/$total steps ($((done * 100 / total))%) in $(duration "$took"), about $(duration $((took * (total - done) / done))) left at this rate"
}

case "${1:-}" in
  (--every)
    [ $# -eq 3 ] || { echo "usage: $(basename "$0") [--every <seconds>] <log>" >&2; exit 2; }
    while :; do
      sleep "$2"
      report "$3"
    done
    ;;
  (*)
    [ $# -eq 1 ] || { echo "usage: $(basename "$0") [--every <seconds>] <log>" >&2; exit 2; }
    report "$1"
    ;;
esac
