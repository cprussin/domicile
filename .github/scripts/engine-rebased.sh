#!/usr/bin/env bash
# Whether a pull request's head already contains its base branch's tip.
#
#   engine-rebased.sh <base-branch> <head-sha>   0 yes, 1 no, 3 could not ask
#
# engine.yml builds for hours on the one `crux`, and a green run is only worth
# that if it is the tree that merges. A head behind its base is not: the base
# has moved under it, and a series that applied and built alone may not with
# what landed since. So such a run is refused before it takes a slot, and again
# after it has waited for one, since the base can move during the wait.
set -u

[ $# -eq 2 ] || { echo "usage: $(basename "$0") <base-branch> <head-sha>" >&2; exit 2; }
base="$1"
head="$2"

# actions/checkout is one commit deep, and ancestry needs the history.
unshallow=()
[ "$(git rev-parse --is-shallow-repository)" = true ] && unshallow=(--unshallow)
git fetch -q --no-tags "${unshallow[@]}" origin \
  "+refs/heads/$base:refs/remotes/origin/$base" "$head" ||
  { echo "could not fetch origin/$base and $head" >&2; exit 3; }
tip="$(git rev-parse "refs/remotes/origin/$base")"

git merge-base --is-ancestor "$tip" "$head"
case $? in
  0) echo "$head contains origin/$base ($tip)" ;;
  1) echo "::error::$head does not contain origin/$base ($tip): rebase onto origin/$base and push" >&2
     exit 1 ;;
  *) echo "could not compare $head with origin/$base" >&2; exit 3 ;;
esac
