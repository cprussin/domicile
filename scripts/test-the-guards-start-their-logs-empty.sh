#!/usr/bin/env bash
# Every log an engine guard starts a process writing into is removed first.
#
# `cmd >"$LOG" 2>&1 &` truncates the log in the forked child, not before the
# next line of the guard runs. A guard that then waits for a line in it can
# read the last run's copy: the claim's, when the control reuses the path, or a
# previous job's, since /tmp outlives jobs on `crux`. Run 36657136674 on
# cprussin/domicile#738: the content-script control found the claim's
# `serving` line, then read the port from a log its own server had just
# emptied -- "its page server never said which port it took".
#
# Removed first, a wait on the log sees nothing until this run's writer writes.
# `>>` is left alone: those logs are meant to gather.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"

checked=0
failed=0
for script in "$SCRIPTS"/guard-*.sh; do
  while IFS=: read -r line log; do
    checked=$((checked + 1))
    if ! head -n "$line" "$script" |
      grep -qE "^ *rm -f .*\"\\\$$log\""; then
      echo "FAIL: $(basename "$script"):$line starts a writer into \$$log without removing it first" >&2
      failed=1
    fi
  done < <(awk '/[^>]>"\$[A-Za-z_]+" 2>&1 &$/ {
    name = $0
    sub(/" 2>&1 &$/, "", name)
    sub(/.*>"\$/, "", name)
    print NR ":" name
  }' "$script")
done

# Nothing checked is a pattern that stopped matching, which would pass silently.
if [ "$checked" -eq 0 ]; then
  echo "FAIL: found no guard under $SCRIPTS that starts a writer into a log" >&2
  exit 1
fi
[ "$failed" -eq 0 ] || exit 1
echo "ok: all $checked logs the guards start writers into are removed first"
