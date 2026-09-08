#!/usr/bin/env bash
# What the reset takes out of the shared checkout, and what it must not.
#
# `git reset --hard` restores tracked files and leaves untracked ones, and that
# one sentence is the whole history of this step: the series' own files are
# untracked in Chromium's repository, so for five runs they survived every
# reset, `apply.sh` refused the tree as dirty, and nothing noticed. It was
# fixed by removing them by name. Then somebody else's work in progress landed
# in the same checkout and failed a pull request that had nothing to do with
# it, and the cause had to be reconstructed from a workflow comment.
#
# So both halves are asserted here: the series' files go, and anything that is
# not the series' STAYS — with a diagnostic that says whose it is and what to
# do. A reset that "fixed" the second failure by deleting the file would pass
# a naive version of this test and destroy hours of somebody's work.
#
# The real script, run at the path it derives its repo root from: it reads
# `CHROMIUM_PIN` and `packages/domicile-engine/src` relative to itself, and a
# test cannot use the real ones (the pin is a Chromium commit no fixture has).
# So the fixture is a repository shaped like this one with the actual script
# copied into place, rather than the script's logic copied into the test.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RESET_SH="$ROOT/.github/scripts/engine-reset.sh"
[ -x "$RESET_SH" ] || { echo "no $RESET_SH" >&2; exit 1; }

command -v git >/dev/null || { echo "  SKIP: no git"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() {
  local what="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then
    printf '  ok    %s\n' "$what"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$what" "$want" "$got"
    FAILED=$((FAILED + 1))
  fi
}
contains() {
  local what="$1" needle="$2" hay="$3"
  case "$hay" in
    (*"$needle"*) printf '  ok    %s\n' "$what" ;;
    (*) printf '  FAIL  %s\n    expected to mention: %s\n    said: %s\n' \
          "$what" "$needle" "$hay"; FAILED=$((FAILED + 1)) ;;
  esac
}

# A repository shaped like this one: the script at the path whose `../..` is
# the root, a pin file, and a series with one file in it at a nested path.
FAKE="$WORK/repo"
mkdir -p "$FAKE/.github/scripts" "$FAKE/packages/domicile-engine/src/components/domicile"
cp "$RESET_SH" "$FAKE/.github/scripts/engine-reset.sh"
cat >"$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" <<'EOF'
// the series' own file
EOF

# And a checkout to reset: one upstream commit, which is the pin.
TREE="$WORK/chromium/src"
mkdir -p "$TREE"
git -C "$TREE" init -q
git -C "$TREE" config user.email upstream@example.invalid
git -C "$TREE" config user.name upstream
echo "upstream" >"$TREE/upstream.cc"
git -C "$TREE" add -A
git -C "$TREE" -c commit.gpgsign=false commit -qm "the pin"
PIN="$(git -C "$TREE" rev-parse HEAD)"
echo "# what the series is against" >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
echo "$PIN" >>"$FAKE/packages/domicile-engine/CHROMIUM_PIN"

# What `apply.sh` leaves behind: the series' files copied in, and a commit per
# patch on top of the pin.
lay_the_series_down() {
  mkdir -p "$TREE/components/domicile"
  cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
    "$TREE/components/domicile/thing.cc"
  echo "patched" >>"$TREE/upstream.cc"
  git -C "$TREE" add upstream.cc
  git -C "$TREE" -c commit.gpgsign=false commit -qm "0001 a patch"
}

reset() { "$FAKE/.github/scripts/engine-reset.sh" "$TREE" 2>&1; }
run_reset() { # status on the first line, output after
  local out
  if out="$(reset)"; then printf 'ok\n%s\n' "$out"; else printf 'refused\n%s\n' "$out"; fi
}
status() { printf '%s\n' "$1" | head -1; }

# ---- the ordinary run: a tree apply.sh has already had -------------------

lay_the_series_down
expect "a tree with the series applied is reset" ok "$(status "$(run_reset)")"
expect "the tree is back at the pin" "$PIN" "$(git -C "$TREE" rev-parse HEAD)"
# The one the five stale runs turned on. `reset --hard` does not touch this
# file, so if this line ever reads `still there`, every run after the first is
# building the first one's sources again.
expect "the series' own file is gone, which reset --hard does not do" \
  "gone" \
  "$([ -e "$TREE/components/domicile/thing.cc" ] && echo "still there" || echo gone)"
expect "and apply.sh will take the tree" "" "$(git -C "$TREE" status --porcelain)"

# Twice in a row, because that is what CI does: this runs before every build,
# and the second run starts from whatever the first left.
lay_the_series_down
expect "and again on the next run" ok "$(status "$(run_reset)")"

# `git am` writes commits, and one that died mid-series leaves .git/rebase-apply
# behind — after which every git command in the tree refuses until it is
# aborted. The abort is the first thing the script does.
lay_the_series_down
mkdir -p "$TREE/.git/rebase-apply"
expect "a tree left mid-\`git am\` is reset rather than refused" ok \
  "$(status "$(run_reset)")"

# The identity `git am` needs, in the checkout's own config: the runner has no
# ~/.gitconfig and never will, and apply.sh runs inside a bwrap FHS shell that
# curates the environment.
expect "the checkout is given an identity to commit with" \
  "domicile CI ci@domicile.invalid" \
  "$(git -C "$TREE" config user.name) $(git -C "$TREE" config user.email)"

# ---- the previous run's series, from a branch this one is not ------------

# THE FAILURE THIS SECTION IS ABOUT. Two branches use one checkout: the first
# lays down a file its `src/` has, the second's `src/` does not have it, so
# removing "the series' files" removes the wrong set and the file survives
# untracked forever. Every run after that stops at the dirty check, on whatever
# pull request happens to be next. It cost two runs and an hour to see.
lay_the_series_down
# A file the *last* run had and this one does not: laid into the tree, and
# absent from the fixture's `src/`.
mkdir -p "$TREE/third_party/blink/renderer/core/html/domicile"
echo "// patch 0007's" \
  >"$TREE/third_party/blink/renderer/core/html/domicile/html_app_element.cc"
# What that run would have written down, at the path the script looks for it.
printf '%s\n' \
  "components/domicile/thing.cc" \
  "third_party/blink/renderer/core/html/domicile/html_app_element.cc" \
  >"$WORK/chromium/.domicile-series-files"

expect "a tree carrying another branch's series is reset, not refused" ok \
  "$(status "$(run_reset)")"
expect "and that branch's file is gone" \
  "gone" \
  "$([ -e "$TREE/third_party/blink/renderer/core/html/domicile/html_app_element.cc" ] &&
       echo "still there" || echo gone)"

# And the manifest now describes *this* run, so the next one can undo it.
expect "the run writes down what it lays down" \
  "components/domicile/thing.cc" \
  "$(cat "$WORK/chromium/.domicile-series-files")"

# The manifest names paths that get removed, so it is read as such. Nothing
# outside the checkout, and nothing above it.
outside="$WORK/not-the-checkout"
echo "do not remove me" >"$outside"
printf '%s\n' "$outside" "../../not-the-checkout" "components/../../../not-the-checkout" \
  >>"$WORK/chromium/.domicile-series-files"
lay_the_series_down
expect "a manifest that points outside the checkout is refused, not followed" ok \
  "$(status "$(run_reset)")"
expect "and what it pointed at is untouched" "do not remove me" "$(cat "$outside")"

# ---- somebody else's work in the same checkout ---------------------------

# Not the series', so nothing removes it by name, and untracked, so the reset
# leaves it. This is the state that failed a pull request that had nothing to
# do with it.
mkdir -p "$TREE/components/domicile/browser"
echo "in progress" >"$TREE/components/domicile/browser/shell_url_loader_factory.cc"
dirty="$(run_reset)"
expect "a tree with somebody's work in it is refused" refused "$(status "$dirty")"
contains "and the file is named" \
  "components/domicile/browser/shell_url_loader_factory.cc" "$dirty"
# `--untracked-files=all`. The default collapses this to `?? components/`,
# which is the line this job actually printed and which names none of the
# files under it.
expect "by its whole path, not as the directory above it" \
  "0" \
  "$(printf '%s\n' "$dirty" | grep -c 'components/domicile/$' || true)"
contains "the message says why reset --hard leaves it" "Untracked" "$dirty"
contains "it gives the mirrored path the file belongs at" \
  "packages/domicile-engine/src/components/domicile/browser/shell_url_loader_factory.cc" \
  "$dirty"
contains "and warns against the tool a reader would reach for" \
  "DO NOT clear this with" "$dirty"

# THE ASSERTION THAT MATTERS MOST HERE. The refusal is an inconvenience; a
# reset that resolved it by deleting the file would be hours of somebody's
# uncommitted work, silently, on a machine where the only copy of it was.
expect "the work is still there afterwards" \
  "in progress" \
  "$(cat "$TREE/components/domicile/browser/shell_url_loader_factory.cc")"

# And it stays refused until somebody deals with it, rather than passing on the
# second attempt because the first one tidied up.
expect "and it is refused again on the next run" refused "$(status "$(run_reset)")"

rm -rf "$TREE/components/domicile/browser"
expect "once the work is out of the tree the reset passes" ok \
  "$(status "$(run_reset)")"

# ---- the other kind of dirty --------------------------------------------

# A tracked file edited by hand. `reset --hard` restores this one, which is
# exactly the difference the diagnostic draws: tracked mods cannot survive the
# reset, so anything that does is someone writing into the tree right now.
echo "someone was editing this" >>"$TREE/upstream.cc"
expect "an edit to an upstream file is reset, not refused" ok \
  "$(status "$(run_reset)")"
expect "and the upstream file is back to the pin's version" "upstream" \
  "$(cat "$TREE/upstream.cc")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
