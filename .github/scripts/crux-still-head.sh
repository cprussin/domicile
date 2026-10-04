#!/usr/bin/env bash
# Whether a run's commit is still its branch's head on origin.
#
#   crux-still-head.sh <branch> <sha>   0 yes, 1 no (moved on or deleted),
#                                       3 could not ask
#
# engine.yml asks this while a run waits for the compile slot. The wait can
# outlast a cold repin, and a run for a replaced commit holds a `crux` runner
# for a result nobody reads.
#
# Not named `engine-*.sh`; see crux-stale-runs.sh.
set -u

[ $# -eq 2 ] || { echo "usage: $(basename "$0") <branch> <sha>" >&2; exit 2; }
branch="$1"
sha="$2"

line="$(git ls-remote --exit-code origin "refs/heads/$branch" 2>&1)"
case $? in
  0) ;;
  2) echo "$branch no longer exists on origin"; exit 1 ;;
  *) echo "could not ask origin where $branch points: $line"; exit 3 ;;
esac

head="${line%%[[:space:]]*}"
if [ "$head" = "$sha" ]; then
  echo "$sha is still $branch's head"
else
  echo "$branch has moved on from $sha to $head"
  exit 1
fi
