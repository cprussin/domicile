#!/usr/bin/env bash
# crux-still-head.sh: whether a run's commit is still what its branch points at.
#
# An engine run waiting for the compile slot can wait hours, and one whose
# branch has since moved on holds a `crux` runner that whole time for a result
# nobody will read. This is the question engine.yml asks while it waits.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STILL_HEAD="$ROOT/.github/scripts/crux-still-head.sh"
[ -x "$STILL_HEAD" ] || { echo "no $STILL_HEAD" >&2; exit 1; }

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
contains() {
  case "$3" in
    (*"$2"*) printf '  ok    %s\n' "$1" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' "$1" "$2" "$3"
        FAILED=$((FAILED + 1)) ;;
  esac
}

git init -q --bare "$WORK/origin.git"
git init -q "$WORK/repo"
cd "$WORK/repo"
git remote add origin "$WORK/origin.git"
git commit -q --allow-empty -m one
first="$(git rev-parse HEAD)"
git push -q origin HEAD:refs/heads/feature 2>/dev/null

still_head() { "$STILL_HEAD" feature "$1" 2>&1; echo "exit=$?"; }

out="$(still_head "$first")"
contains "the branch's own head is still wanted" "exit=0" "$out"

git commit -q --allow-empty -m two
second="$(git rev-parse HEAD)"
git push -q origin HEAD:refs/heads/feature 2>/dev/null
out="$(still_head "$first")"
contains "a commit the branch has moved past is not" "exit=1" "$out"
contains "and it names what replaced it" "$second" "$out"
contains "the new head is" "exit=0" "$(still_head "$second")"

git push -q origin :refs/heads/feature 2>/dev/null
out="$(still_head "$second")"
contains "a deleted branch's run is not wanted" "exit=1" "$out"
contains "saying the branch is gone" "no longer exists" "$out"

git remote set-url origin "$WORK/nowhere.git"
out="$(still_head "$second")"
contains "an unreachable origin is an error, not an answer" "exit=3" "$out"

# And engine.yml asks it while it waits for the compile slot, and turns a
# "no" into a cancel rather than a red run.
WORKFLOW="$ROOT/.github/workflows/engine.yml"
step() { awk -v n="      - name: $1" '$0 == n {on=1; print; next} on && /^      - name:/ {exit} on' "$WORKFLOW"; }
slot="$(step "Take the compile slot")"
contains "the slot step asks this while it waits" "crux-still-head.sh" "$slot"
contains "only for a pull request from this repository" "head.repo.full_name == github.repository" "$slot"
cancel="$(step "Cancel this run, its commit was replaced")"
contains "a superseded wait cancels the run" "steps.slot.outputs.superseded == 'true'" "$cancel"
contains "the run cancels itself" 'actions/runs/${{ github.run_id }}/cancel' "$cancel"
grep -A3 '^permissions:' "$WORKFLOW" | grep -q 'actions: write'
expect "which needs actions: write" 0 "$?"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all ok"
