#!/usr/bin/env bash
# Whether a run's commit is still what its branch points at on origin.
#
#   crux-still-head.sh <branch> <sha>   0 yes, 1 no (moved on or deleted),
#                                       3 could not ask
#
# engine.yml asks this while a run waits for the compile slot. That wait can
# outlast a cold repin, and a run whose branch has moved on holds a `crux`
# runner the whole time for a result nobody will read.
#
# Not named `engine-*.sh`, for crux-stale-runs.sh's reason: engine.yml runs on
# changes to those, and a change to this is not a change to the build.
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
