#!/usr/bin/env bash
# One writer at a time in /build/chromium/src.
#
# CI resets and patches the shared checkout on every run, and people build in
# it for hours. A reset during a build does not fail: `siso` links a binary from
# a mix of two trees. Anyone about to change or compile the tree takes this
# lock first. See packages/domicile-engine/docs/BUILD-MACHINE.md.
#
#   .github/scripts/engine-tree-lock.sh take /build/chromium/src "$WHO"
#   .github/scripts/engine-tree-lock.sh drop /build/chromium/src "$WHO"
#   .github/scripts/engine-tree-lock.sh holds /build/chromium/src "$WHO"
#
# - `mkdir` creates and tests in one syscall, so taking the lock has no race.
# - The lock lives outside `src/`: an untracked file there makes `apply.sh`
#   refuse the tree.
# - It is advisory. Both writers cooperate, so that is enough.
set -u

usage() {
  echo "usage: $(basename "$0") <take|drop|holds|who|path> <chromium> [owner]" >&2
  exit 2
}

action="${1:-}"
chromium="${2:-}"
owner="${3:-}"
[ -n "$action" ] && [ -n "$chromium" ] || usage

# One lock per tree, at the build root, named after the resolved tree.
#
# `/build/chromium` is a symlink into one of `engine-tree-pool.sh`'s trees.
# Resolving it makes `/build/chromium/src` and `/build/trees/tree-0/src` take
# the same lock. Runs in different trees do not collide, so each tree has its
# own lock. Tests override the path because they have no /build.
LOCK="${DOMICILE_TREE_LOCK:-}"
if [ -z "$LOCK" ]; then
  # `pwd -P` resolves the symlink. A path that does not exist yet falls back
  # to a single shared lock.
  slot="$(cd "$(dirname "$chromium")" 2>/dev/null && pwd -P)" || slot=""
  root="${DOMICILE_BUILD_ROOT:-/build}"
  if [ -n "$slot" ]; then
    LOCK="$root/.domicile-tree-lock-$(basename "$slot")"
  else
    LOCK="$root/.domicile-tree-lock"
  fi
fi

# The lock's age, so a reader can tell a running build from a stale lock.
age() {
  local since now secs
  since="$(cat "$LOCK/since" 2>/dev/null || true)"
  case "$since" in
    (*[!0-9]*|'') echo "unknown age (no readable timestamp in the lock)"; return ;;
  esac
  now="$(date +%s)"
  secs=$((now - since))
  # A negative age means the clock moved.
  [ "$secs" -ge 0 ] || { echo "unknown age (its timestamp is in the future)"; return; }
  if [ "$secs" -lt 3600 ]; then
    echo "held for $((secs / 60))m"
  else
    echo "held for $((secs / 3600))h $(((secs % 3600) / 60))m"
  fi
}

holder() {
  cat "$LOCK/owner" 2>/dev/null || echo "someone who did not write their name in it"
}

case "$action" in
  take)
    [ -n "$owner" ] || usage
    if mkdir "$LOCK" 2>/dev/null; then
      echo "$owner" >"$LOCK/owner"
      date +%s >"$LOCK/since"
      date -Is >"$LOCK/since-human"
      echo "took $chromium as '$owner'"
      exit 0
    fi
    # Held. The message gives what a reader needs to wait or clear it.
    {
      echo "::error::$chromium is locked by '$(holder)' ($(age)), so this run will not touch it"
      echo "The lock is at $LOCK, taken $(cat "$LOCK/since-human" 2>/dev/null || echo 'at an unrecorded time')."
      echo
      echo "It exists because this job resets that checkout to the pin, and a"
      echo "reset landing inside somebody else's build does not fail: siso"
      echo "keeps going and links a binary compiled from two different trees."
      echo
      echo "If that build is still running, wait and re-run this job — a"
      echo "Chromium build is up to four hours."
      echo
      echo "If it is not — a job died, a machine rebooted, the age above is"
      echo "implausible — the lock is stale and this clears it:"
      echo
      echo "  rm -rf $LOCK"
      echo
      echo "Nothing clears it automatically. A timeout that guesses wrong"
      echo "here does the exact thing the lock is for preventing."
    } >&2
    exit 1
    ;;

  drop)
    [ -n "$owner" ] || usage
    # Idempotent: this runs from an `if: always()` step, including when the
    # take failed.
    [ -d "$LOCK" ] || { echo "no lock at $LOCK to drop"; exit 0; }
    held="$(holder)"
    if [ "$held" != "$owner" ]; then
      # Never delete another owner's lock. A cleanup after a failed take would
      # otherwise release a tree in the middle of someone else's build.
      echo "left $LOCK alone: it belongs to '$held', not to '$owner'"
      exit 0
    fi
    rm -rf "$LOCK"
    echo "dropped $chromium"
    ;;

  # For a job that runs in a tree another job took: engine.yml's checks run in
  # the tree its build job kept locked. If the lock changed hands, the tree may
  # have been reset.
  holds)
    [ -n "$owner" ] || usage
    [ -d "$LOCK" ] || { echo "::error::$chromium is not locked, so '$owner' does not hold it" >&2; exit 1; }
    held="$(holder)"
    if [ "$held" != "$owner" ]; then
      echo "::error::$chromium is locked by '$held' ($(age)), not by '$owner'" >&2
      exit 1
    fi
    echo "'$owner' still holds $chromium ($(age))"
    ;;

  who)
    if [ -d "$LOCK" ]; then
      echo "$chromium is locked by '$(holder)' ($(age))"
    else
      echo "$chromium is not locked"
    fi
    ;;

  # Lets engine-tree-pool.sh find the lock without recomputing its path.
  path) printf '%s\n' "$LOCK" ;;

  *) usage ;;
esac
