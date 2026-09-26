#!/usr/bin/env bash
# Whether a push run's commit is still the last one on its branch that
# engine.yml will build.
#
#   crux-still-latest.sh <branch> <sha>   0 yes, 1 no (a later commit gets its
#                                         own run), 3 could not ask
#
# engine.yml asks this while a push run waits for the compile slot; see
# crux-still-head.sh for a pull request's. Main's run for 13cc49a waited over
# six hours there while main moved four commits past it.
#
# NOT "IS IT STILL THE HEAD", because the push filter means most commits get no
# engine run: a run given up for a later README fix is replaced by nothing. So
# the question is whether anything engine.yml's `on.push.paths` covers differs
# between <sha> and the branch's head. When it does, some push since touched an
# engine path and started a run of its own. When it does not, this run builds
# the same engine inputs the head has.
#
# Read from engine.yml, not copied. Its `!` patterns become pathspec excludes,
# which drop a file whatever order they come in where GitHub lets the last
# pattern win; the difference can only keep a run waiting, never end one.
#
# Not named `engine-*.sh`, for crux-stale-runs.sh's reason: engine.yml runs on
# changes to those, and a change to this is not a change to the build.
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
