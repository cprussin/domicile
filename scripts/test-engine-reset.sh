#!/usr/bin/env bash
# Asserts what `engine-reset.sh` removes from the shared checkout and what it
# keeps.
#
# `git reset --hard` leaves untracked files. The series' own files are
# untracked in Chromium, so the script removes them by name. Any other
# untracked file may be someone's work in progress: the script must keep it and
# refuse with a diagnostic, not delete it.
#
# The real script runs from a fixture shaped like this repository, since it
# reads `CHROMIUM_PIN` and `packages/domicile-engine/src` relative to itself.
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

# A repository like this one: the script at the path whose `../..` is the
# root, a pin file, and a series with one file at a nested path.
FAKE="$WORK/repo"
mkdir -p "$FAKE/.github/scripts" "$FAKE/packages/domicile-engine/src/components/domicile"
cp "$RESET_SH" "$FAKE/.github/scripts/engine-reset.sh"
cat >"$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" <<'EOF'
// the series' own file
EOF

# A checkout to reset, with one upstream commit as the pin.
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

# What `apply.sh` leaves: the series' files copied in, and a commit per patch
# on top of the pin.
lay_the_series_down() {
  mkdir -p "$TREE/components/domicile"
  cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
    "$TREE/components/domicile/thing.cc"
  echo "patched" >>"$TREE/upstream.cc"
  git -C "$TREE" add upstream.cc
  git -C "$TREE" -c commit.gpgsign=false commit -qm "0001 a patch"
}

reset() { "$FAKE/.github/scripts/engine-reset.sh" "${1:-$TREE}" 2>&1; }
run_reset() { # [checkout] — status on the first line, output after
  local out
  if out="$(reset "$@")"; then printf 'ok\n%s\n' "$out"; else printf 'refused\n%s\n' "$out"; fi
}
status() { printf '%s\n' "$1" | head -1; }

# ---- the ordinary run: a tree apply.sh has already had -------------------

lay_the_series_down
expect "a tree with the series applied is reset" ok "$(status "$(run_reset)")"
expect "the tree is back at the pin" "$PIN" "$(git -C "$TREE" rev-parse HEAD)"
# `reset --hard` does not remove this file. If it survives, every later run
# builds stale sources.
expect "the series' own file is gone, which reset --hard does not do" \
  "gone" \
  "$([ -e "$TREE/components/domicile/thing.cc" ] && echo "still there" || echo gone)"
expect "and apply.sh will take the tree" "" "$(git -C "$TREE" status --porcelain)"

# Twice in a row, as in CI: the second run starts from what the first left.
lay_the_series_down
expect "and again on the next run" ok "$(status "$(run_reset)")"

# An interrupted `git am` leaves .git/rebase-apply, and every git command
# refuses until it is aborted. The script aborts it first.
lay_the_series_down
mkdir -p "$TREE/.git/rebase-apply"
expect "a tree left mid-\`git am\` is reset rather than refused" ok \
  "$(status "$(run_reset)")"

# A killed git leaves .git/index.lock, and later git commands fail with
# "index.lock: File exists". The job holds the tree lock, so the file is stale.
lay_the_series_down
touch "$TREE/.git/index.lock"
stale="$(run_reset)"
expect "a tree with a stale index.lock is reset rather than refused" ok \
  "$(status "$stale")"
contains "and says it removed the lock" "removed a stale" "$stale"

# `git am --abort` does not always remove rebase-apply; what remains depends
# on the git version and where am stopped. A stray file stands in for those
# cases.
lay_the_series_down
rm -rf "$TREE/.git/rebase-apply"
echo "left by a killed git am" >"$TREE/.git/rebase-apply"
stray="$(run_reset)"
expect "a tree whose rebase-apply outlives the abort is reset" ok \
  "$(status "$stray")"
expect "and git am can run in it again" gone \
  "$([ -e "$TREE/.git/rebase-apply" ] && echo "still there" || echo gone)"

# `git am` needs an identity in the checkout's config: the runner has no
# ~/.gitconfig, and apply.sh runs in a bwrap FHS shell with a curated
# environment.
expect "the checkout is given an identity to commit with" \
  "domicile CI ci@domicile.invalid" \
  "$(git -C "$TREE" config user.name) $(git -C "$TREE" config user.email)"

# ---- a path with no checkout behind it -----------------------------------

# A path with no checkout must be reported as such. Otherwise every `git -C`
# fails and the fetch's error blames the server for refusing a revision, which
# misleads the reader.
missing="$(run_reset "$WORK/no-such-tree/src")"
expect "a checkout that is not there is refused" refused "$(status "$missing")"
contains "and the path is named" "$WORK/no-such-tree/src" "$missing"
expect "and it is not diagnosed as a server refusing a revision" "0" \
  "$(printf '%s\n' "$missing" | grep -c 'would not serve' || true)"

# A directory without a repository. `git -C` reports `not a git repository`
# here; the script must still name the checkout.
mkdir -p "$WORK/not-a-checkout/src"
not_git="$(run_reset "$WORK/not-a-checkout/src")"
expect "a path that is not a git checkout is refused" refused "$(status "$not_git")"
contains "and says that is what is wrong with it" "not a git checkout" "$not_git"

# ---- the previous run's series, from a branch this one is not ------------

# Two branches share one checkout. Removing only this branch's series files
# would leave a file from the previous branch's series untracked, and every
# later run would fail the dirty check.
lay_the_series_down
# A file the previous run laid down that this branch's `src/` lacks.
mkdir -p "$TREE/third_party/blink/renderer/core/html/domicile"
echo "// patch 0007's" \
  >"$TREE/third_party/blink/renderer/core/html/domicile/html_app_element.cc"
# The previous run's manifest, at the path the script reads.
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

# The manifest now lists this run's files, so the next run can remove them.
expect "the run writes down what it lays down" \
  "components/domicile/thing.cc" \
  "$(cat "$WORK/chromium/.domicile-series-files")"

# The manifest names paths to delete, so paths outside the checkout are
# ignored.
outside="$WORK/not-the-checkout"
echo "do not remove me" >"$outside"
printf '%s\n' "$outside" "../../not-the-checkout" "components/../../../not-the-checkout" \
  >>"$WORK/chromium/.domicile-series-files"
lay_the_series_down
expect "a manifest that points outside the checkout is refused, not followed" ok \
  "$(status "$(run_reset)")"
expect "and what it pointed at is untouched" "do not remove me" "$(cat "$outside")"

# ---- somebody else's work in the same checkout ---------------------------

# Untracked and not the series', so the reset neither removes nor restores it.
mkdir -p "$TREE/components/domicile/browser"
echo "in progress" >"$TREE/components/domicile/browser/shell_url_loader_factory.cc"
dirty="$(run_reset)"
expect "a tree with somebody's work in it is refused" refused "$(status "$dirty")"
contains "and the file is named" \
  "components/domicile/browser/shell_url_loader_factory.cc" "$dirty"
# Requires `--untracked-files=all`: the default collapses this to
# `?? components/`, which names no file.
expect "by its whole path, not as the directory above it" \
  "0" \
  "$(printf '%s\n' "$dirty" | grep -c 'components/domicile/$' || true)"
contains "the message says why reset --hard leaves it" "Untracked" "$dirty"
contains "it gives the mirrored path the file belongs at" \
  "packages/domicile-engine/src/components/domicile/browser/shell_url_loader_factory.cc" \
  "$dirty"
contains "and warns against the tool a reader would reach for" \
  "DO NOT clear this with" "$dirty"

# The reset must never delete the file: it may be the only copy of someone's
# uncommitted work.
expect "the work is still there afterward" \
  "in progress" \
  "$(cat "$TREE/components/domicile/browser/shell_url_loader_factory.cc")"

# It stays refused until someone removes the work.
expect "and it is refused again on the next run" refused "$(status "$(run_reset)")"

rm -rf "$TREE/components/domicile/browser"
expect "once the work is out of the tree the reset passes" ok \
  "$(status "$(run_reset)")"

# ---- the other kind of dirty --------------------------------------------

# `reset --hard` restores a tracked file, so tracked edits are not refused.
# Only untracked files can mean someone is writing into the tree.
echo "someone was editing this" >>"$TREE/upstream.cc"
expect "an edit to an upstream file is reset, not refused" ok \
  "$(status "$(run_reset)")"
expect "and the upstream file is back to the pin's version" "upstream" \
  "$(cat "$TREE/upstream.cc")"

# ---- a pin the checkout has never heard of -------------------------------

# A repin: `CHROMIUM_PIN` names a revision the checkout lacks, so the script
# fetches it before resetting. `engine-sync.sh` syncs DEPS afterward and is
# tested in `test-engine-sync.sh`.

# An upstream with a commit the checkout lacks.
UPSTREAM="$WORK/upstream"
git clone -q "$TREE" "$UPSTREAM"
git -C "$UPSTREAM" config user.email upstream@example.invalid
git -C "$UPSTREAM" config user.name upstream
echo "a later revision" >>"$UPSTREAM/upstream.cc"
git -C "$UPSTREAM" add -A
git -C "$UPSTREAM" -c commit.gpgsign=false commit -qm "what the pin moves to"
NEW_PIN="$(git -C "$UPSTREAM" rev-parse HEAD)"
git -C "$TREE" remote add origin "$UPSTREAM"
repin() {
  echo "# what the series is against" >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
  echo "$1" >>"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
}

# A server with `uploadpack.allowReachableSHA1InWant` (as Chromium's has) can
# fetch a single revision, which costs only the commits in between.
git -C "$UPSTREAM" config uploadpack.allowReachableSHA1InWant true
repin "$NEW_PIN"
expect "a pin the checkout does not have is fetched rather than refused" ok \
  "$(status "$(run_reset)")"
expect "and the tree is at it" "$NEW_PIN" "$(git -C "$TREE" rev-parse HEAD)"

# Most servers refuse a fetch by revision, so the script falls back to an
# ordinary fetch.
git -C "$UPSTREAM" config uploadpack.allowReachableSHA1InWant false
git -C "$TREE" -c advice.detachedHead=false checkout -q "$PIN"
git -C "$TREE" fetch -q origin "+refs/heads/*:refs/hidden/*" 2>/dev/null || true
rm -rf "$TREE/.git/refs/remotes/origin" "$TREE/.git/refs/hidden"
echo "another later revision" >>"$UPSTREAM/upstream.cc"
git -C "$UPSTREAM" add -A
git -C "$UPSTREAM" -c commit.gpgsign=false commit -qm "and another"
NEWER_PIN="$(git -C "$UPSTREAM" rev-parse HEAD)"
repin "$NEWER_PIN"
expect "a server that will not serve one revision is fetched from wholesale" ok \
  "$(status "$(run_reset)")"
expect "and the tree is at that pin too" "$NEWER_PIN" "$(git -C "$TREE" rev-parse HEAD)"

# A pin upstream lacks is a typo or an unpushed revision. The error must name
# the revision and `CHROMIUM_PIN`, not fail inside `git reset`.
repin "0000000000000000000000000000000000000000"
missing="$(run_reset)"
expect "a pin upstream does not have is refused" refused "$(status "$missing")"
contains "and the revision is named" "0000000000000000000000000000000000000000" "$missing"
contains "with the file to look at" "CHROMIUM_PIN" "$missing"
repin "$NEWER_PIN"

# ---- DEPS that are out of step with the pin ------------------------------

# Chromium's DEPS are git submodules. `reset --hard` does not move a
# submodule's working tree, so after a `gclient sync` at another pin, `git
# status` reports each dep as ` M` until a sync at this pin runs.
#
# `engine-sync.sh` runs right after this script and fixes that, so the reset
# must not refuse. It excuses only out-of-step deps, nothing else in the tree.

# A dep with two revisions, as a real submodule (`.gitmodules` and a gitlink),
# as in a Chromium checkout.
DEP="$WORK/dep"
mkdir -p "$DEP"
git -C "$DEP" init -q
git -C "$DEP" config user.email dep@example.invalid
git -C "$DEP" config user.name dep
echo "at the pin" >"$DEP/dep.cc"
git -C "$DEP" add -A
git -C "$DEP" -c commit.gpgsign=false commit -qm "the revision DEPS names at the pin"
DEP_AT_PIN="$(git -C "$DEP" rev-parse HEAD)"
echo "a later revision" >>"$DEP/dep.cc"
git -C "$DEP" -c commit.gpgsign=false commit -qam "the revision a newer DEPS names"
DEP_AHEAD="$(git -C "$DEP" rev-parse HEAD)"

# git refuses file:// submodule clones by default since CVE-2022-39253.
git -C "$TREE" -c protocol.file.allow=always submodule add -q "$DEP" third_party/dep
git -C "$TREE/third_party/dep" checkout -q "$DEP_AT_PIN"
git -C "$TREE" add -A
git -C "$TREE" -c commit.gpgsign=false commit -qm "a pin whose DEPS are submodules"
SUB_PIN="$(git -C "$TREE" rev-parse HEAD)"
repin "$SUB_PIN"

# The stamp `engine-sync.sh` reads to decide whether to skip the sync, at its
# default path.
STAMP="$WORK/chromium/.domicile-synced-pin"
stamp_says_the_pin() { printf '%s\n' "$SUB_PIN" >"$STAMP"; }

# The state a sync at another pin leaves: the submodule at the other revision
# and the superproject back on the pin.
diverge_the_deps() { git -C "$TREE/third_party/dep" checkout -q "$DEP_AHEAD"; }
step_the_deps_back() { git -C "$TREE/third_party/dep" checkout -q "$DEP_AT_PIN"; }

# A sync at another pin can also leave a dep this pin does not name. It is a
# gclient clone with its own repository, so `git status -uall` lists only its
# directory.
a_dep_this_pin_does_not_name() {
  mkdir -p "$TREE/third_party/jetstream/v3.0"
  git -C "$TREE/third_party/jetstream/v3.0" init -q
  echo "fetched by a sync at another pin" >"$TREE/third_party/jetstream/v3.0/JetStream.js"
}

# ---- neither kind of dirty ----

stamp_says_the_pin
# The stamp must survive, or every build runs a `gclient sync` first.
expect "a clean tree is reset without comment" ok "$(status "$(run_reset)")"
expect "and the sync's fast path is left alone" "$SUB_PIN" "$(cat "$STAMP")"

# ---- DEPS out of step, and nothing else ----

diverge_the_deps
deps="$(run_reset)"
expect "DEPS out of step with the pin are not treated as contamination" ok \
  "$(status "$deps")"
contains "the dep is named" "third_party/dep" "$deps"
contains "and it says whose job it is" "engine-sync.sh" "$deps"
# A gitlink is not a file, so there is no mirrored path to suggest.
expect "it does not tell anyone to commit a submodule into the series" "0" \
  "$(printf '%s\n' "$deps" | grep -c 'packages/domicile-engine/src/third_party/dep' || true)"
expect "and the sync cannot be skipped after it" "" "$(cat "$STAMP" 2>/dev/null)"
# The reset leaves the dep alone. `apply.sh` refuses it if the sync does not
# fix it.
expect "the reset leaves the dep where it found it" "$DEP_AHEAD" \
  "$(git -C "$TREE/third_party/dep" rev-parse HEAD)"

# ---- a dep this pin does not name, alongside them ----

stamp_says_the_pin
a_dep_this_pin_does_not_name
both="$(run_reset)"
expect "a dep the pin does not name is deferred to the same sync" ok \
  "$(status "$both")"
contains "and named" "third_party/jetstream/v3.0/" "$both"
expect "the sync cannot be skipped after that either" "" "$(cat "$STAMP" 2>/dev/null)"
expect "and nothing of it is deleted here" "fetched by a sync at another pin" \
  "$(cat "$TREE/third_party/jetstream/v3.0/JetStream.js")"

# ---- a loose untracked file, alongside them ----

# The deferral must not cover loose files. `gclient sync -D` removes only deps
# listed in `.gclient_entries`, so a stray file would reach `apply.sh` without
# this script's diagnostic.
stamp_says_the_pin
mkdir -p "$TREE/components/domicile/browser"
echo "in progress" >"$TREE/components/domicile/browser/shell_url_loader_factory.cc"
loose="$(run_reset)"
expect "somebody's work is refused even while the DEPS are out of step" refused \
  "$(status "$loose")"
contains "and named" \
  "components/domicile/browser/shell_url_loader_factory.cc" "$loose"
contains "with the mirrored path to commit it at" \
  "packages/domicile-engine/src/components/domicile/browser/shell_url_loader_factory.cc" \
  "$loose"
expect "the work is still there afterward" "in progress" \
  "$(cat "$TREE/components/domicile/browser/shell_url_loader_factory.cc")"
expect "and a refusal leaves the stamp alone" "$SUB_PIN" "$(cat "$STAMP")"
rm -rf "$TREE/components/domicile"
rm -rf "$TREE/third_party/jetstream"

# ---- a tracked file that is not a dep, alongside them ----

# `reset --hard` restores tracked files, so a dirty tracked file was written
# afterward, here by a bad manifest entry. It is not a gitlink, so the sync
# will not fix it.
stamp_says_the_pin
printf '%s\n' "upstream.cc" >"$WORK/chromium/.domicile-series-files"
tracked_too="$(run_reset)"
expect "a tracked file gone missing is refused even while the DEPS are out of step" \
  refused "$(status "$tracked_too")"
contains "and named" "upstream.cc" "$tracked_too"
expect "and that refusal leaves the stamp alone too" "$SUB_PIN" "$(cat "$STAMP")"
git -C "$TREE" checkout -q -- upstream.cc

# ---- a dep dirty in its own files, with its revision at the pin ----

# ` M third_party/dep` can mean a different revision or a dirty working tree.
# Only the first is a pin mismatch. `gclient sync --reset` does not pass
# `--force`, so it leaves stray files; clearing the stamp here would force a
# full sync on every later build and fix nothing.
stamp_says_the_pin
step_the_deps_back
echo "left by a build" >"$TREE/third_party/dep/scratch.o"
content="$(run_reset)"
expect "a dep dirty in its own files is refused, not called a pin mismatch" \
  refused "$(status "$content")"
expect "and the fast path is left alone, so ordinary builds stay fast" \
  "$SUB_PIN" "$(cat "$STAMP")"
rm -f "$TREE/third_party/dep/scratch.o"

# ---- a stamp that names another pin ----

# The state after a repin. The stamp must be cleared, since the DEPS match
# neither pin until a sync runs.
printf '%s\n' "0000000000000000000000000000000000000000" >"$STAMP"
diverge_the_deps
expect "a stamp naming another pin is cleared too, not left standing" ok \
  "$(status "$(run_reset)")"
expect "and it claims neither pin afterward" "" "$(cat "$STAMP" 2>/dev/null)"
step_the_deps_back

# Both scripts must use the same stamp path, or the sync's fast path skips a
# sync this script requested.
stamp_line() { grep '^STAMP=' "$1"; }
expect "the stamp path is engine-sync.sh's, character for character" \
  "$(stamp_line "$ROOT/.github/scripts/engine-sync.sh")" \
  "$(stamp_line "$RESET_SH")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
