#!/usr/bin/env bash
# One writer at a time in /build/chromium/src.
#
# The checkout is shared. CI resets it to the pin and applies the series over
# it on every run; a person or an agent working on the fork builds in it for
# hours at a time. Those two are not compatible, and the way they collide is
# not the obvious one.
#
# THE FAILURE THIS PREVENTS IS SILENT. A `git reset --hard` that lands on a
# tree with uncommitted work in it destroys the work, which is loud and which
# the reset step's own diagnostic now explains. A `git reset --hard` that lands
# *during a build* does something worse: `siso` keeps going, reads some
# translation units from before the reset and some from after, and links a
# binary compiled against a mixture of two trees. Nothing fails. The artifact
# is wrong in a way no later step looks for, and a clean Chromium build is
# four hours, so the cost of discovering it later is the whole build again.
#
# So: whoever is about to change or compile that tree takes this first.
#
#   .github/scripts/engine-tree-lock.sh take /build/chromium/src "$WHO"
#   .github/scripts/engine-tree-lock.sh drop /build/chromium/src "$WHO"
#
# `mkdir` is the whole mechanism, because it is the one filesystem operation
# that both creates and tests in the same syscall. A `[ -e ]` followed by a
# `touch` is two, and two is a race — narrow enough that it would hold for
# months and then not.
#
# The lock lives beside the checkout rather than inside it, and that is not a
# preference: a file inside `src/` is untracked in Chromium's repository, which
# is exactly what makes `git status --porcelain` non-empty, which is exactly
# what `apply.sh` refuses. A lock that fails the build it is protecting is not
# a lock.
#
# It is advisory. Nothing enforces it, and anything that does not take it wins
# by ignoring it. That is the correct amount of mechanism here: there are two
# writers, both cooperating, and the thing worth having is the one that turns a
# silent corruption into a queue.
set -u

usage() {
  echo "usage: $(basename "$0") <take|drop|who> <chromium> [owner]" >&2
  exit 2
}

action="${1:-}"
chromium="${2:-}"
owner="${3:-}"
[ -n "$action" ] && [ -n "$chromium" ] || usage

# Beside the checkout, so `/build/chromium/src` -> `/build/chromium`. Override
# for tests, which have no /build and should not want one.
LOCK="${DOMICILE_TREE_LOCK:-$(dirname "$chromium")/.domicile-tree-lock}"

# How long, in the units a person reads. The timestamp alone answers "when",
# which is the question nobody has: the question is whether this has been held
# for eight minutes (someone is working, wait) or eleven hours (a job died and
# left it, clear it).
age() {
  local since now secs
  since="$(cat "$LOCK/since" 2>/dev/null || true)"
  case "$since" in
    (*[!0-9]*|'') echo "unknown age (no readable timestamp in the lock)"; return ;;
  esac
  now="$(date +%s)"
  secs=$((now - since))
  # A lock from the future is a clock that moved, not a lock held for -3h.
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
    # Held. Everything a reader needs to decide between waiting and clearing,
    # in the message rather than in a comment in a workflow file — the last
    # time this went wrong the cause had to be reconstructed from a shell loop
    # and a `paths:` filter.
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
    # Idempotent, and it has to be: this runs from an `if: always()` step, so
    # it also runs on the path where taking the lock is what failed.
    [ -d "$LOCK" ] || { echo "no lock at $LOCK to drop"; exit 0; }
    held="$(holder)"
    if [ "$held" != "$owner" ]; then
      # THE CASE THAT MAKES THIS A CHECK RATHER THAN AN `rm`. A cleanup step
      # that runs unconditionally would otherwise delete the lock of whoever
      # this run failed to take it from — releasing a tree in the middle of
      # their build, which is the corruption this file exists to prevent,
      # arrived at through the mechanism meant to prevent it.
      echo "left $LOCK alone: it belongs to '$held', not to '$owner'"
      exit 0
    fi
    rm -rf "$LOCK"
    echo "dropped $chromium"
    ;;

  who)
    if [ -d "$LOCK" ]; then
      echo "$chromium is locked by '$(holder)' ($(age))"
    else
      echo "$chromium is not locked"
    fi
    ;;

  *) usage ;;
esac
