#!/usr/bin/env bash
# Whether every engine guard and spike removes its browser profile on exit.
#
# Each one wipes its profile before it starts Chrome, and until this, never
# after. On crux /tmp is tmpfs, private to the runner's unit and cleared only
# when the unit stops, so the last run's profiles stayed in RAM: 230-630M each,
# 5.1G on one runner on 2026-09-28, beside a cold Chromium link that needs most
# of the machine.
#
# Not moved under $TMPDIR instead: Chrome's process singleton puts a socket
# beside the profile, the job's $TMPDIR is two nix shells deep, and that path
# is past the 107 bytes a Unix socket allows -- see spike.sh.
#
# A script that hands its profile to spike.sh, as a `PROFILE=... \` prefix on
# that command, leaves the removal to spike.sh, which is checked like the rest.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/packages/domicile-engine/scripts"

checked=0
failed=0
for script in "$SCRIPTS"/*.sh; do
  grep -q 'PROFILE="${PROFILE:-[^}]*}"$' "$script" || continue
  checked=$((checked + 1))
  handler=$(sed -n "s/^ *trap \(.*\) EXIT$/\1/p" "$script" | head -n 1)
  case "$handler" in
    "'"*) on_exit="$handler" ;;
    ?*) on_exit=$(sed -n "/^$handler() {/,/^}/p" "$script") ;;
    *) on_exit="" ;;
  esac
  if ! printf '%s\n' "$on_exit" | grep -qF 'rm -rf "$PROFILE"'; then
    echo "FAIL: $(basename "$script") leaves \$PROFILE behind when it exits" >&2
    failed=1
  fi
done

# Nothing checked is a pattern that stopped matching, which would pass silently.
if [ "$checked" -eq 0 ]; then
  echo "FAIL: found no script under $SCRIPTS that makes its own profile" >&2
  exit 1
fi
[ "$failed" -eq 0 ] || exit 1
echo "ok: all $checked guards and spikes that make a profile remove it on exit"
