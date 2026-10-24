#!/usr/bin/env bash
# Removes a guard's browser profile at exit.
#
#   . "$SCRIPTS/lib-profile.sh"
#   cleanup() { kill ...; remove_profile "$PROFILE"; }
#
# After the browser is killed, its children (the network service among them)
# keep writing into the profile until they notice, so one `rm -rf` fails with
# "Directory not empty". This retries until the writing stops.
#
# It retries rather than kill the writers: crux's runners share a process
# table but each has its own /tmp, so a process holding a file at this path
# may be another run's engine.
#
# Checked by `packages/domicile-engine/tests/test-a-profile-is-removed-while-the-engine-still-writes.sh`.

# Removes `$1`, retrying for up to five seconds. Each try checks after a
# pause, so a write that recreates the profile is caught. Says so on stderr if
# the profile is still there after that.
remove_profile() {
  for _ in $(seq 1 25); do
    rm -rf "$1" 2>/dev/null
    sleep 0.2
    [ -e "$1" ] || return 0
  done
  echo "the engine was still writing into $1 after five seconds; leaving it" >&2
}
