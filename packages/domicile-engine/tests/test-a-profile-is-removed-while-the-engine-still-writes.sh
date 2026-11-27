#!/usr/bin/env bash
# Checks that `remove_profile` removes a profile the engine's children are
# still writing into, and that it gives up rather than hang.
#
# After the browser is killed, its children (the network service among them)
# keep writing into the profile until they notice. A single `rm -rf` loses
# that race with "Directory not empty", or the next write recreates what it
# removed. A stand-in for `rm` here plays the writer: after each removal it
# writes a file back into `Default/`, for a set number of removals or for
# all of them. The writer counts removals, not seconds, so how busy the
# machine is cannot change which removal it stops after.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LIB="$ROOT/packages/domicile-engine/scripts/lib-profile.sh"
[ -f "$LIB" ] || { echo "FAIL: no $LIB" >&2; exit 1; }
# shellcheck source=packages/domicile-engine/scripts/lib-profile.sh
. "$LIB"

WORK="$(mktemp -d)"
trap 'command rm -rf "$WORK"' EXIT
# Fd 3 is the test's own stderr, since `remove_profile` sends its `rm`'s to
# /dev/null.
exec 3>&2

# The number of removals the writer writes after, or `always`.
WRITES_AFTER=0
# The number of times `remove_profile` has removed the profile.
REMOVALS=0
# A removal past this many means `remove_profile` never gives up. The test
# fails then, rather than hang.
MOST_REMOVALS=100

# This stands in for `remove_profile`'s `rm`. It removes, then lets the
# writer write once more.
rm() {
  command rm "$@"
  REMOVALS=$((REMOVALS + 1))
  if [ "$REMOVALS" -gt "$MOST_REMOVALS" ]; then
    echo "FAIL: removal kept trying past $MOST_REMOVALS removals of a profile still written to" >&3
    exit 1
  fi
  if [ "$WRITES_AFTER" = always ] || [ "$REMOVALS" -le "$WRITES_AFTER" ]; then
    mkdir -p "$PROFILE/Default" && : >"$PROFILE/Default/f$REMOVALS"
  fi
}

# Makes a fresh profile at `$WORK/$1` whose writer writes after `$2`
# removals. Sets PROFILE.
a_profile() {
  PROFILE="$WORK/$1"
  WRITES_AFTER="$2"
  REMOVALS=0
  mkdir -p "$PROFILE/Default"
  : >"$PROFILE/Default/f0"
}

failed=0

# A writer that stops: the profile goes once the writer has stopped.
a_profile stops 3
remove_profile "$PROFILE" 2>"$WORK/stops.err"
if [ -e "$PROFILE" ]; then
  echo "FAIL: a profile whose writer stopped after 3 removals was left behind after $REMOVALS" >&2
  cat "$WORK/stops.err" >&2
  failed=1
elif [ "$REMOVALS" -lt 4 ]; then
  echo "FAIL: a profile written to after 3 removals was gone after $REMOVALS, before the writer stopped" >&2
  failed=1
fi

# A writer that never stops: removal gives up and says so.
a_profile never always
remove_profile "$PROFILE" 2>"$WORK/never.err"
if [ ! -e "$PROFILE" ]; then
  echo "FAIL: a profile written to after every removal is gone, so the writer never wrote" >&2
  failed=1
fi
if [ "$REMOVALS" -lt 2 ]; then
  echo "FAIL: removal gave up after $REMOVALS removal(s) of a profile still written to" >&2
  failed=1
fi
if ! grep -qF "$PROFILE" "$WORK/never.err"; then
  echo "FAIL: a profile left behind was not named on stderr" >&2
  failed=1
fi

[ "$failed" -eq 0 ] || exit 1
echo "ok: a profile still written to is removed once the writing stops, and given up on while it goes on ($REMOVALS tries)"
