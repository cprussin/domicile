#!/usr/bin/env bash
# Tests that engine guards remove each log before starting a process that
# writes to it.
#
# `cmd >"$LOG" 2>&1 &` truncates the log in the forked child, possibly after
# the guard's next line runs. A guard waiting for a line can then read a stale
# copy: the claim's, when the control reuses the path, or a previous job's,
# since /tmp outlives jobs on `crux` (seen in run 36657136674 on
# cprussin/domicile#738).
#
# Logs written with `>>` are meant to accumulate and are not checked.
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

# Zero checks means the pattern stopped matching.
if [ "$checked" -eq 0 ]; then
  echo "FAIL: found no guard under $SCRIPTS that starts a writer into a log" >&2
  exit 1
fi
[ "$failed" -eq 0 ] || exit 1
echo "ok: all $checked logs the guards start writers into are removed first"
