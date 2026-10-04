#!/usr/bin/env bash
# Whether a push run's commit is still the last one on its branch that
# engine.yml will build.
#
#   crux-still-latest.sh <branch> <sha>   0 yes, 1 no (a later commit gets its
#                                         own run), 3 could not ask
#
# engine.yml asks this while a push run waits for the compile slot;
# crux-still-head.sh covers pull requests. Without it a push run can wait hours
# after main has moved on.
#
# The push path filter means most commits get no engine run, so checking for
# the head would give up runs nothing replaces. Instead this checks whether any
# path in engine.yml's `on.push.paths` differs between <sha> and the head. If
# one does, a later push started its own run.
#
# The paths are read from engine.yml. Its `!` patterns become pathspec
# excludes, which apply regardless of order, while GitHub lets the last
# matching pattern win. The difference can only keep a run waiting, never end
# one.
#
# Not named `engine-*.sh`; see crux-stale-runs.sh.
set -u

[ $# -eq 2 ] || { echo "usage: $(basename "$0") <branch> <sha>" >&2; exit 2; }
branch="$1"
sha="$2"

# Only the head's tree is needed, and a checkout is one commit deep.
why="$(git fetch -q --depth=1 origin "refs/heads/$branch" 2>&1)" ||
  { echo "could not fetch $branch from origin: $why"; exit 3; }
head="$(git rev-parse FETCH_HEAD)"

pathspecs=()
while IFS= read -r pattern; do
  case "$pattern" in
    (!*) pathspecs+=(":(glob,exclude)${pattern#!}") ;;
    (*) pathspecs+=(":(glob)$pattern") ;;
  esac
done < <(awk '
  /^  push:/ { on = 1; next }
  on && /^  [^[:space:]#]/ { exit }
  on && /^      - / { sub(/^      - /, ""); gsub(/"/, ""); print }
' "$(dirname "$0")/../workflows/engine.yml")

why="$(git diff --quiet "$sha" "$head" -- "${pathspecs[@]}" 2>&1)"
case $? in
  0) echo "nothing engine.yml builds has changed on $branch since $sha" ;;
  1) echo "$branch has moved on from $sha to $head, which changes what engine.yml builds"
     exit 1 ;;
  *) echo "could not compare $sha with $branch: $why"; exit 3 ;;
esac
