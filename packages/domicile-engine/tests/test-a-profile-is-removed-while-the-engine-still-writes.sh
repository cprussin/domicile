#!/usr/bin/env bash
# Checks that `remove_profile` removes a profile the engine's children are
# still writing into, and that it gives up rather than hang.
#
# After the browser is killed, its children (the network service among them)
# keep writing into the profile until they notice. A single `rm -rf` loses
# that race with "Directory not empty". A writer here stands in for them: a
# background loop creating files in `Default/`.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LIB="$ROOT/packages/domicile-engine/scripts/lib-profile.sh"
[ -f "$LIB" ] || { echo "FAIL: no $LIB" >&2; exit 1; }
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$LIB"

WORK="$(mktemp -d)"
WRITER=""
trap '[ -z "$WRITER" ] || kill -KILL "$WRITER" 2>/dev/null; rm -rf "$WORK"' EXIT

# Writes files into `$1/Default` for `$2` seconds, as fast as it can. With
# `$3` set, it also recreates `Default`, so the profile never goes.
a_writer() {
  local profile="$1" until=$((SECONDS + $2)) recreate="${3:-}" i=0
  while [ "$SECONDS" -lt "$until" ]; do
    i=$((i + 1))
    [ -z "$recreate" ] || mkdir -p "$profile/Default" 2>/dev/null
    { : >"$profile/Default/f$i"; } 2>/dev/null
  done
}

# Makes a fresh profile at `$WORK/$1` and starts `a_writer` on it with the
# rest of the arguments. Sets PROFILE and WRITER.
a_profile() {
  PROFILE="$WORK/$1"
  shift
  mkdir -p "$PROFILE/Default"
  a_writer "$PROFILE" "$@" &
  WRITER=$!
}

failed=0

# A writer that stops within the budget: the profile goes.
a_profile stops 2
sleep 0.2
remove_profile "$PROFILE" 2>"$WORK/stops.err"
wait "$WRITER"
if [ -e "$PROFILE" ]; then
  echo "FAIL: a profile written to for two seconds was left behind" >&2
  cat "$WORK/stops.err" >&2
  failed=1
fi

# A writer that outlasts the budget: removal gives up and says so.
a_profile never 30 recreate
sleep 0.2
started=$SECONDS
remove_profile "$PROFILE" 2>"$WORK/never.err"
took=$((SECONDS - started))
kill -KILL "$WRITER" 2>/dev/null
wait "$WRITER" 2>/dev/null
WRITER=""
if [ "$took" -gt 10 ]; then
  echo "FAIL: removal kept trying for ${took}s while the profile was written to" >&2
  failed=1
fi
if ! grep -qF "$PROFILE" "$WORK/never.err"; then
  echo "FAIL: a profile left behind was not named on stderr" >&2
  failed=1
fi

[ "$failed" -eq 0 ] || exit 1
echo "ok: a profile still written to is removed once the writing stops"
