#!/usr/bin/env bash
# engine-proof.sh: a proved tree is not proved again.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROOF="$ROOT/.github/scripts/engine-proof.sh"
[ -x "$PROOF" ] || { echo "no $PROOF" >&2; exit 1; }

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
git init -q "$WORK/repo"
cd "$WORK/repo"
git remote add origin "$WORK/origin.git"
mkdir -p packages/domicile-engine packages/domicile-compositor
echo pin >packages/domicile-engine/CHROMIUM_PIN
echo old >packages/domicile-engine/engine-release.nix
echo fn >packages/domicile-compositor/lib.rs
echo doc >README.md
git add -A && git commit -qm one && git push -q origin HEAD:main 2>/dev/null

key() { "$PROOF" key; }
commit() { git add -A && git commit -qm "$1"; }
base="$(key)"

echo new >packages/domicile-engine/engine-release.nix; commit repin
expect "writing engine-release.nix back is the same tree" "$base" "$(key)"

echo more >>README.md; commit docs
expect "markdown is the same tree" "$base" "$(key)"

echo fn2 >packages/domicile-compositor/lib.rs; commit compositor
changed="$(key)"
[ "$changed" != "$base" ] && r=differs || r=same
expect "the compositor is part of what is proved" differs "$r"

"$PROOF" has "$changed"
expect "an unproved tree is not proved" 1 "$?"

"$PROOF" record "$changed" >/dev/null 2>&1
expect "recording succeeds" 0 "$?"
# The same tree again, from another commit: a PR's merge commit proved it and
# main's squash, or a dispatch, is proving it again.
git commit -q --allow-empty -m "same tree"
"$PROOF" record "$changed" >/dev/null 2>&1
expect "recording a tree already proved succeeds" 0 "$?"

"$PROOF" has "$changed"
expect "a recorded tree is proved" 0 "$?"

"$PROOF" has "$base"
expect "and no other" 1 "$?"

gate() { # event, pinned check exit status
  : >"$WORK/out"
  GITHUB_OUTPUT="$WORK/out" GITHUB_EVENT_NAME="$1" \
    DOMICILE_PINNED_ENGINE_CHECK="$(command -v "$2")" "$PROOF" gate >/dev/null
  grep '^proved=' "$WORK/out" | cut -d= -f2
}
expect "a proved tree whose engine-release.nix names it is skipped" true "$(gate push true)"
expect "one whose engine-release.nix does not is not" false "$(gate push false)"
expect "a dispatch always runs" false "$(gate workflow_dispatch true)"
: >"$WORK/out"
GITHUB_OUTPUT="$WORK/out" GITHUB_EVENT_NAME=push DOMICILE_PINNED_ENGINE_CHECK="$(command -v true)" \
  "$PROOF" gate >/dev/null
expect "the gate hands on the key" "key=$changed" "$(grep '^key=' "$WORK/out")"
echo x >>packages/domicile-compositor/lib.rs; commit unproved
expect "an unproved tree is not skipped" false "$(gate push true)"

git remote set-url origin "$WORK/nowhere.git"
"$PROOF" has "$changed" 2>/dev/null
rc=$?
[ "$rc" -ne 0 ] && [ "$rc" -ne 1 ] && r=error || r="$rc"
expect "an unreachable remote is an error, not an answer" error "$r"

[ "$FAILED" -eq 0 ] || { echo "$FAILED failed"; exit 1; }
echo "all ok"
