#!/usr/bin/env bash
# Tests `crux-still-latest.sh`: whether a push run's commit is still the latest
# on its branch that engine.yml will build.
#
# A push run is replaced only by a later commit that gets its own engine run,
# and engine.yml's path filter decides which commits do. Checking only "is this
# the head" would cancel a run that nothing will replace.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STILL_LATEST="$ROOT/.github/scripts/crux-still-latest.sh"
[ -x "$STILL_LATEST" ] || { echo "no $STILL_LATEST" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

FAILED=0
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
land() { # path
  mkdir -p "$(dirname "$1")"
  echo "$RANDOM" >>"$1"
  git add "$1"
  git commit -q -m "$1"
  git push -q origin HEAD:refs/heads/main 2>/dev/null
}
still_latest() { "$STILL_LATEST" main "$1" 2>&1; echo "exit=$?"; }

land packages/domicile-engine/patches/0001-a.patch
run="$(git rev-parse HEAD)"
contains "main's head is still wanted" "exit=0" "$(still_latest "$run")"

# Neither commit starts an engine run, so neither replaces this one. The second
# is the release write-back engine.yml pushes itself.
land README.md
contains "a later commit touching no engine path does not replace it" \
  "exit=0" "$(still_latest "$run")"
land packages/domicile-engine/engine-release.nix
contains "nor does one touching a path the filter excludes" \
  "exit=0" "$(still_latest "$run")"

land packages/domicile-engine/patches/0002-b.patch
newer="$(git rev-parse HEAD)"
out="$(still_latest "$run")"
contains "a later commit engine.yml builds replaces it" "exit=1" "$out"
contains "and it names what replaced it" "$newer" "$out"
contains "that commit's own run is wanted" "exit=0" "$(still_latest "$newer")"
contains "a commit it cannot compare is an error, not an answer" \
  "exit=3" "$(still_latest 0000000000000000000000000000000000000000)"

git remote set-url origin "$WORK/nowhere.git"
contains "an unreachable origin is an error, not an answer" \
  "exit=3" "$(still_latest "$newer")"

# engine.yml asks this for push runs while they wait for the compile slot.
WORKFLOW="$ROOT/.github/workflows/engine.yml"
slot="$(awk '$0 == "      - name: Take the compile slot" {on=1; print; next}
             on && /^      - name:/ {exit} on' "$WORKFLOW")"
contains "the slot step asks this for a push run" \
  "github.event_name == 'push' && '.github/scripts/crux-still-latest.sh" "$slot"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all ok"
