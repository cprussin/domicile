#!/usr/bin/env bash
# Tests that every engine guard and spike removes its browser profile on exit.
#
# On crux /tmp is tmpfs, private to the runner's unit and cleared only when the
# unit stops. Leftover profiles are 230-630M each and compete for RAM with a
# cold Chromium link.
#
# Profiles cannot move under $TMPDIR: Chrome puts a singleton socket beside
# the profile, and the job's $TMPDIR is too deep for the 107-byte Unix socket
# path limit (see spike.sh).
#
# A script that passes its profile to spike.sh with a `PROFILE=... \` prefix
# leaves the removal to spike.sh, which is checked too.
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

# Zero checks means the pattern stopped matching.
if [ "$checked" -eq 0 ]; then
  echo "FAIL: found no script under $SCRIPTS that makes its own profile" >&2
  exit 1
fi
[ "$failed" -eq 0 ] || exit 1
echo "ok: all $checked guards and spikes that make a profile remove it on exit"
