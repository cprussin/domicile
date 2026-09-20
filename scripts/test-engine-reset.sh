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
expect "the work is still there afterward" \
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

# ---- a pin the checkout has never heard of -------------------------------

# WHAT A REPIN LOOKS LIKE FROM HERE, and the reason this section exists: the
# revision in `CHROMIUM_PIN` is newer than anything in the shared checkout, so
# `reset --hard` has nothing to reset to. Every engine workflow used to stop
# at that point with an instruction to go and run `git fetch origin` on the
# build host by hand, which made moving the pin a two-machine operation. The
# fetch is this script's now. `engine-sync.sh` is the other half — the DEPS —
# and `test-engine-sync.sh` asserts that one.

# An upstream with a commit this checkout does not have.
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

# Fetching by revision is what a server with `uploadpack.allowReachableSHA1InWant`
# allows — Chromium's does — and it costs the commits between here and there
# rather than every ref there is.
git -C "$UPSTREAM" config uploadpack.allowReachableSHA1InWant true
repin "$NEW_PIN"
expect "a pin the checkout does not have is fetched rather than refused" ok \
  "$(status "$(run_reset)")"
expect "and the tree is at it" "$NEW_PIN" "$(git -C "$TREE" rev-parse HEAD)"

# And where the server does not allow that, which most do not: it refuses the
# request rather than 404ing, so the ordinary fetch is the fallback and the
# pin has to arrive by it.
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

# A pin nobody has is a typo or an unpushed revision, and it is the one case
# left that a person has to answer. It must say so rather than fail inside a
# `git reset` whose message names neither the file nor the fix.
repin "0000000000000000000000000000000000000000"
missing="$(run_reset)"
expect "a pin upstream does not have is refused" refused "$(status "$missing")"
contains "and the revision is named" "0000000000000000000000000000000000000000" "$missing"
contains "with the file to look at" "CHROMIUM_PIN" "$missing"
repin "$NEWER_PIN"

# ---- DEPS that are out of step with the pin ------------------------------

# WHAT BLOCKED EVERY ENGINE BUILD IN THE REPOSITORY ON 2026-09-20, and the one
# kind of dirty that is nobody's mistake. Chromium's DEPS are git submodules of
# the superproject, so they are gitlinks rather than files — and `reset --hard`
# in a superproject does not touch a submodule's working tree. A `gclient sync`
# at a newer revision moves them; the next run's reset puts the superproject
# back on the pin and cannot put them back with it; `git status` then reports
# every one of them as ` M`, and the tree stays that way until a sync at the
# pin runs.
#
# `engine-sync.sh` is that sync and it runs immediately after this script, so
# the state is the next step's input rather than a reason to stop. What must
# not happen is this step refusing the job before that step can fix it, which
# is what failed three pull requests and `main` in one morning.
#
# What must ALSO not happen is the deferral becoming a hole: a dep out of step
# excuses the dep, and nothing else in the tree.

# A dep with two revisions, carried as a real submodule: `.gitmodules` and a
# gitlink, which is what a Chromium checkout has.
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

# `protocol.file.allow`: git refuses a file:// submodule clone by default since
# CVE-2022-39253, and the fixture has nowhere else to clone one from.
git -C "$TREE" -c protocol.file.allow=always submodule add -q "$DEP" third_party/dep
git -C "$TREE/third_party/dep" checkout -q "$DEP_AT_PIN"
git -C "$TREE" add -A
git -C "$TREE" -c commit.gpgsign=false commit -qm "a pin whose DEPS are submodules"
SUB_PIN="$(git -C "$TREE" rev-parse HEAD)"
repin "$SUB_PIN"

# The stamp `engine-sync.sh` reads to decide whether it may skip the sync, at
# the path it derives when nothing overrides it.
STAMP="$WORK/chromium/.domicile-synced-pin"
stamp_says_the_pin() { printf '%s\n' "$SUB_PIN" >"$STAMP"; }

# What a sync at another pin leaves behind, exactly: the submodule's working
# tree at the other revision, and the superproject back on the pin.
diverge_the_deps() { git -C "$TREE/third_party/dep" checkout -q "$DEP_AHEAD"; }
step_the_deps_back() { git -C "$TREE/third_party/dep" checkout -q "$DEP_AT_PIN"; }

# And what that sync also leaves: a dep a newer DEPS names and this pin does
# not. It is a gclient clone, so it is a git repository of its own, which is
# why `git status -uall` prints it as a directory rather than listing the files
# under it — the real one read `?? third_party/jetstream/v3.0/`.
a_dep_this_pin_does_not_name() {
  mkdir -p "$TREE/third_party/jetstream/v3.0"
  git -C "$TREE/third_party/jetstream/v3.0" init -q
  echo "fetched by a sync at another pin" >"$TREE/third_party/jetstream/v3.0/JetStream.js"
}

# ---- neither kind of dirty ----

stamp_says_the_pin
# Nothing to say, and above all nothing to clear. A reset that dropped the
# stamp here would put a `gclient sync` in front of every ordinary build, which
# is minutes on the one machine that has the tree.
expect "a clean tree is reset without comment" ok "$(status "$(run_reset)")"
expect "and the sync's fast path is left alone" "$SUB_PIN" "$(cat "$STAMP")"

# ---- DEPS out of step, and nothing else ----

diverge_the_deps
deps="$(run_reset)"
expect "DEPS out of step with the pin are not treated as contamination" ok \
  "$(status "$deps")"
contains "the dep is named" "third_party/dep" "$deps"
contains "and it says whose job it is" "engine-sync.sh" "$deps"
# The advice the old diagnostic gave for this class, which is wrong for it: a
# gitlink is not a file, and there is no mirrored path it belongs at.
expect "it does not tell anyone to commit a submodule into the series" "0" \
  "$(printf '%s\n' "$deps" | grep -c 'packages/domicile-engine/src/third_party/dep' || true)"
expect "and the sync cannot be skipped after it" "" "$(cat "$STAMP" 2>/dev/null)"
# This step cannot fix that and does not pretend to. `apply.sh` is the gate
# that still refuses it, after the sync has had its turn.
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

# THE HOLE THE DEFERRAL MUST NOT OPEN. `gclient sync -D` removes a *dep* the
# current DEPS no longer names — it reads `.gclient_entries`, not the tree — so
# it does nothing at all about a file somebody wrote. Deferring one would hand
# the refusal to `apply.sh` minutes later, with none of the advice below it and
# none of the warning against `git clean -fdx`.
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

# `reset --hard` restores a tracked file, so the only way one is dirty when
# this check runs is that something wrote it afterward — here, this script's
# own manifest naming a path it should not. Whatever wrote it, it is not a
# gitlink and the sync will not put it back.
stamp_says_the_pin
printf '%s\n' "upstream.cc" >"$WORK/chromium/.domicile-series-files"
tracked_too="$(run_reset)"
expect "a tracked file gone missing is refused even while the DEPS are out of step" \
  refused "$(status "$tracked_too")"
contains "and named" "upstream.cc" "$tracked_too"
expect "and that refusal leaves the stamp alone too" "$SUB_PIN" "$(cat "$STAMP")"
git -C "$TREE" checkout -q -- upstream.cc

# ---- a dep dirty in its own files, with its revision at the pin ----

# NOT A PIN MISMATCH, so not the sync's and not a reason to clear the stamp.
# ` M third_party/dep` means either "the recorded revision is not this one" or
# "there is something in its working tree", and only the first is what
# `engine-sync.sh` exists to fix — `gclient sync --reset` does not pass
# `--force`, so a stray file inside a dep survives it. Clearing the stamp for
# one would put a full `gclient sync` in front of every build from then on, and
# fix nothing.
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

# The state the repin left the machine in. It must not come out of this
# claiming anything: the DEPS it describes are at neither pin until a sync
# says otherwise.
printf '%s\n' "0000000000000000000000000000000000000000" >"$STAMP"
diverge_the_deps
expect "a stamp naming another pin is cleared too, not left standing" ok \
  "$(status "$(run_reset)")"
expect "and it claims neither pin afterward" "" "$(cat "$STAMP" 2>/dev/null)"
step_the_deps_back

# THE TWO SCRIPTS MUST NAME THE SAME FILE. This one clears the stamp and that
# one reads it; a path spelled two ways is a fast path that skips the sync this
# step just asked for, and nothing would say so.
stamp_line() { grep '^STAMP=' "$1"; }
expect "the stamp path is engine-sync.sh's, character for character" \
  "$(stamp_line "$ROOT/.github/scripts/engine-sync.sh")" \
  "$(stamp_line "$RESET_SH")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
