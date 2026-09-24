#!/usr/bin/env bash
# engine-rebased.sh: only a head that already contains its base's tip is built.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REBASED="$ROOT/.github/scripts/engine-rebased.sh"
[ -x "$REBASED" ] || { echo "no $REBASED" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
expect() {
  if [ "$3" = "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

git init -q --bare "$WORK/origin.git"
git init -q -b main "$WORK/author"
cd "$WORK/author"
git remote add origin "$WORK/origin.git"
commit() { echo "$1" >"$1" && git add "$1" && git commit -qm "$1" && git rev-parse HEAD; }
commit one >/dev/null
git push -q origin HEAD:refs/heads/main 2>/dev/null
git checkout -qb current
current="$(commit current)"
git push -q origin HEAD:refs/heads/current 2>/dev/null
git checkout -q main
commit two >/dev/null
git push -q origin HEAD:refs/heads/main 2>/dev/null
git checkout -qb stale HEAD~1
stale="$(commit stale)"
git push -q origin HEAD:refs/heads/stale 2>/dev/null
git checkout -qb merged main
git merge -q --no-edit current
merged="$(git rev-parse HEAD)"
git push -q origin HEAD:refs/heads/merged 2>/dev/null
git checkout -qb rebased main
rebased="$(commit rebased)"
git push -q origin HEAD:refs/heads/rebased 2>/dev/null

# The runner's checkout: one commit deep, which is what actions/checkout makes.
git clone -q --depth 1 "file://$WORK/origin.git" "$WORK/runner" 2>/dev/null
cd "$WORK/runner"
rebased_on() { "$REBASED" main "$1" >/dev/null 2>&1; echo $?; }

expect "a head on main's tip is built" 0 "$(rebased_on "$rebased")"
expect "a head that merged main in is built" 0 "$(rebased_on "$merged")"
expect "a head on an old main is refused" 1 "$(rebased_on "$current")"
expect "and so is one branched from before main's tip" 1 "$(rebased_on "$stale")"

"$REBASED" main "$stale" 2>&1 | grep -q "rebase onto origin/main"
expect "a refusal says what to do" 0 "$?"

git remote set-url origin "$WORK/nowhere.git"
expect "an unreachable remote is an error, not an answer" 3 "$(rebased_on "$rebased")"

# And engine.yml asks it: once off `crux` before the job queues for it, and once
# on `crux` after the compile slot, since both are waits the base can move in.
WORKFLOW="$ROOT/.github/workflows/engine.yml"
job() { awk -v j="  $1:" '$0 == j {on=1; next} on && /^  [a-z]/ {exit} on' "$WORKFLOW"; }
job rebased | grep -q 'engine-rebased.sh'
expect "a job off crux asks before the engine queues" 0 "$?"
job engine | grep -q "needs: \[gate, rebased\]"
expect "the engine job waits on it" 0 "$?"
job engine | grep -q "needs.rebased.result == 'success'"
expect "and does not run when it refuses" 0 "$?"
job engine | awk '/name: Take the compile slot/ {slot=1} slot && /engine-rebased.sh/ {found=1} END {exit !found}'
expect "the engine job asks again once it has the compile slot" 0 "$?"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all ok"
