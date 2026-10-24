#!/usr/bin/env bash
# Runs each check it is given, one at a time, and reports each as passed,
# failed or skipped. See `src/report.sh` for the verdicts and the variables
# that change them.
#
#   check-runner tests/*.sh
#
# Serial, because checks may share fixed paths such as sockets.
set -u

. "$(dirname "$(realpath "$0")")/../src/report.sh"

report_start
for script in "$@"; do
  run "$(basename "$script" .sh)" "$script"
done
report_end
