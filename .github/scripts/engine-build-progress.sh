#!/usr/bin/env bash
# Say how far a Chromium build has got, from siso's lines in its log.
#
#   .github/scripts/engine-build-progress.sh /tmp/domicile-shell.log
#   .github/scripts/engine-build-progress.sh --every 300 --total <file> \
#     --status <sha> /tmp/domicile-shell.log
#
# CI prints the build's log only once the build ends. `--every` prints a line
# each period until it is killed. The first line waits a period, by when
# nix-shell has truncated the last build's log.
#
# siso prints `[finished/total] elapsed ...` for each step. Both counts and the
# time restart when engine-yielding-build.sh restarts the build. `--total`
# names a file that keeps the largest total this job has seen, so the percent
# counts the whole job's steps across restarts. The rate is the restarted
# build's own.
#
# `--status <sha>` also posts each line as that commit's pending status
# (engine-build-status.sh), which GitHub shows while the job runs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

usage() {
  echo "usage: $(basename "$0") [--every <seconds>] [--total <file>] [--status <sha>] <log>" >&2
  exit 2
}

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

# The job's total: the largest of <total> and what <file> holds, kept in <file>.
job_total() { # total, file
  if [ -z "$2" ]; then
    echo "$1"
    return
  fi
  local kept=0
  [ -e "$2" ] && kept="$(cat "$2")"
  if [ "$1" -gt "$kept" ]; then
    echo "$1" >"$2"
    kept="$1"
  fi
  echo "$kept"
}

report() { # log, total file
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
  local done="${BASH_REMATCH[1]}" total="${BASH_REMATCH[2]}" took
  took="$(seconds "${BASH_REMATCH[3]}")"
  local left=$((total - done)) all
  all="$(job_total "$total" "$2")"
  local finished=$((all - left))
  echo "build progress: $finished/$all steps ($((finished * 100 / all))%), about $(duration $((took * left / done))) left at this rate"
}

every="" total_file="" sha=""
while [ $# -gt 1 ]; do
  case "$1" in
    (--every) every="$2" ;;
    (--total) total_file="$2" ;;
    (--status) sha="$2" ;;
    (*) usage ;;
  esac
  shift 2
done
[ $# -eq 1 ] || usage
log="$1"

if [ -z "$every" ]; then
  report "$log" "$total_file"
  exit 0
fi

last=""
while :; do
  sleep "$every"
  line="$(report "$log" "$total_file")"
  # The same line twice means no step finished in a period: the build stepped
  # aside, or one step is long, such as the final link.
  if [ "$line" = "$last" ]; then
    line="$line; no step finished in the last $(duration "${every%.*}")"
  else
    last="$line"
  fi
  echo "$line"
  if [ -n "$sha" ]; then
    # A status GitHub refused is reported and the build goes on.
    "$HERE/engine-build-status.sh" "$sha" pending "${line#build progress: }" || true
  fi
done
