#!/usr/bin/env bash
# Put the shared Chromium checkout at the pin, so `apply.sh` will take it —
# fetching the revision first when the pin has moved past what the tree has.
#
# All three engine workflows do this and they must do it identically:
# `engine.yml` before every proof build, `engine-release.yml` before every
# published one, `engine-drm-probe.yml` before every probe. It was written
# twice, the two copies drifted in the order of their steps, and a third copy
# is what this file exists to prevent.
#
#   .github/scripts/engine-reset.sh /build/chromium/src
#
# `engine-sync.sh` is the half that comes after it: this puts the checkout on
# the pin, that puts everything `DEPS` names at the pin. Between them a repin
# is a commit to this repository and nothing on the build host.
#
# `apply.sh` is idempotent for `src/` (a copy) and not for `patches/` — `git am`
# refuses to apply a patch twice — so the tree has to go back to the pin before
# every run.
#
# AND THE SERIES' OWN FILES HAVE TO GO WITH IT, which `reset --hard` does not
# do: they are untracked in Chromium's repository, and `reset` only touches
# what is tracked. `apply.sh` refuses a tree that `git status --porcelain`
# calls dirty — deliberately, it is not going to guess — so from the second run
# onward it stopped before it began, and because a command run through
# NIX_SHELL_RUN does not reliably carry its exit status out, nothing noticed.
# Every run after the first used the first one's sources and the first one's
# build.
#
# AND THE DEPS ARE NOT THIS SCRIPT'S AT ALL. Chromium's DEPS are submodules of
# the superproject, `reset --hard` does not touch a submodule's working tree,
# and a `gclient sync` at another pin therefore leaves this step looking at
# modified gitlinks it cannot restore and never could. That is
# `engine-sync.sh`'s to fix and it runs next, so this step says so and defers
# rather than refusing the job in front of the thing that repairs it. The long
# version is beside the check itself, at the bottom.
#
# Removed file by file rather than with `git clean`, which would be the obvious
# tool and is the wrong one here: `-fd` would also delete anything else
# untracked that gclient's hooks put in this tree, and rebuilding it is four
# hours. The series knows exactly which files it lays down, so it removes
# exactly those — and anything left over after that is, by construction,
# somebody else's, which is what the diagnostic at the bottom is about.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CHROMIUM="${1:-}"
[ -n "$CHROMIUM" ] || { echo "usage: $(basename "$0") <chromium checkout>" >&2; exit 2; }

SERIES="$ROOT/packages/domicile-engine/src"
pin="$(grep -v '^#' "$ROOT/packages/domicile-engine/CHROMIUM_PIN" | tr -d '[:space:]')"

# In case a previous run died mid-series and left the rebase-apply state
# behind. It fails when there is nothing to abort, which is the ordinary case.
git -C "$CHROMIUM" am --abort 2>/dev/null || true

# THE PIN MAY BE NEWER THAN THIS CHECKOUT, which is exactly what a repin is,
# and getting it is this script's job rather than a person's. All three engine
# workflows used to stop here with "roll the checkout forward by hand" — so
# moving one line in `CHROMIUM_PIN` meant an ssh session on the build host
# before CI could say anything about the change, and an agent that can only
# reach this repository could not move the pin at all.
#
# The DEPS are the other half and are `engine-sync.sh`'s, which runs after this
# and is where the minutes go. This part is a fetch.
git -C "$CHROMIUM" cat-file -e "$pin^{commit}" 2>/dev/null || {
  echo "the checkout does not have $pin; fetching it"
  # By revision first, which costs the commits between here and there rather
  # than every ref in a repository with a great many of them. It needs
  # `uploadpack.allowReachableSHA1InWant` on the server — Chromium's Gitiles
  # has it — and a server without it refuses the request rather than answering
  # it empty. So the wholesale fetch is the fallback and not the first try,
  # and which one this run took is said out loud: the refusal reads like a
  # missing revision, and the next person here should not have to tell them
  # apart from an empty log.
  if ! git -C "$CHROMIUM" fetch --quiet origin "$pin" 2>/dev/null; then
    echo "origin would not serve that one revision; fetching everything"
    git -C "$CHROMIUM" fetch origin
  fi
}

# Still not there, so it is not a revision upstream has: a typo in the pin
# file, or a revision that only ever existed in somebody's local tree. That is
# the one case here a person still has to answer, so it says which file to look
# at rather than failing inside a `git reset` that names neither.
git -C "$CHROMIUM" cat-file -e "$pin^{commit}" 2>/dev/null || {
  echo "::error::$pin is not a revision $CHROMIUM's origin has" >&2
  echo "It came from packages/domicile-engine/CHROMIUM_PIN, and a fetch did not find it." >&2
  echo "Either it is mistyped, or it is a commit that was never pushed upstream." >&2
  exit 1
}

git -C "$CHROMIUM" reset --hard "$pin"

# THE SERIES THAT RAN LAST, NOT ONLY THE ONE ABOUT TO. Removing what *this*
# branch's `src/` holds is right for one branch and wrong the moment two use
# the tree: a run that lays down `html_app_element.cc` and a next run from a
# branch without it leaves the file untracked, forever, and every run after
# that stops here. That is not a hypothetical — it is what the first two runs
# after this workflow started sharing a checkout did.
#
# So each run writes down what it is about to lay down, beside the checkout
# where the next run can read it, and the next run removes that list as well as
# its own. Only ever files this workflow put there: nothing is guessed, and
# anything not on either list is somebody else's and is left alone for the
# diagnostic below to explain.
MANIFEST="${DOMICILE_SERIES_MANIFEST:-$(dirname "$CHROMIUM")/.domicile-series-files}"
series_files() { (cd "$SERIES" && find . -type f | sed 's|^\./||'); }

# The manifest is ours, but it names paths that get `rm`ed, so it is read the
# way anything that names paths to remove should be: absolute paths and `..`
# are dropped rather than trusted, and a truncated or hand-edited file can
# therefore only under-remove.
{
  grep -Ev '^/|(^|/)\.\.(/|$)' "$MANIFEST" 2>/dev/null || true
  series_files
} | sort -u |
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    rm -f "$CHROMIUM/$file"
  done

# Written before `apply.sh` rather than after, so a run that dies mid-series
# still leaves the next one able to clean up after it. It lists what would be
# laid down, so at worst it names a file that is not there, which `rm -f` does
# not mind.
series_files | sort > "$MANIFEST"

# In this checkout's own config, not the environment. `git am` writes commits
# and refuses to without an identity; the runner unit has no ~/.gitconfig,
# because its HOME is the work directory the module deletes on every start. The
# GIT_* environment variables would do it too — except `apply.sh` runs inside
# upstream's buildFHSEnv, whose bwrap hands the command a curated environment,
# and an identity that may or may not survive that is not one to depend on. The
# config lives in .git/config, which `reset --hard` does not touch and which is
# the same file from inside the sandbox.
git -C "$CHROMIUM" config user.name "domicile CI"
git -C "$CHROMIUM" config user.email "ci@domicile.invalid"

# `--untracked-files=all` rather than the default, which collapses an untracked
# directory to one line ending in `/`. `?? components/domicile/` is the exact
# line this job printed the last time this fired, and the three files under it
# — which is what a reader needs to see and what the advice below is about —
# were not in the message at all.
dirty="$(git -C "$CHROMIUM" status --porcelain --untracked-files=all)"
[ -n "$dirty" ] || exit 0

# THE DEPS ARE NOT THIS SCRIPT'S TO RESTORE, SO THEY ARE NOT ITS TO REFUSE.
#
# Chromium's DEPS are git submodules of the superproject: `third_party/angle`,
# `net/third_party/quiche/src` and everything else DEPS names are gitlinks
# rather than files. `git reset --hard` in a superproject writes the gitlink
# and leaves the submodule's own working tree exactly where it was — so the
# reset above cannot put a dep back at the pin's revision, and never could.
# What `git status` then reports is ` M third_party/angle`, which looks like a
# tracked file somebody edited and is nothing of the kind.
#
# That state is the ordinary consequence of a repin rather than an accident.
# The run that moves `CHROMIUM_PIN` is the first to sync the DEPS forward; from
# then until that repin merges, every run still on the old pin resets the
# superproject back and finds the DEPS ahead of it. On 2026-09-20 that locked
# out three pull requests and `main` in twelve minutes, each in four seconds,
# with a diagnostic telling their authors to commit a submodule into
# `packages/domicile-engine/src/`.
#
# `engine-sync.sh` runs immediately after this step and is exactly the thing
# that fixes it — `gclient sync --revision "$SOLUTION@$PIN" --reset
# --delete_unversioned_trees` puts every dep back at the pin's revision and
# removes the deps a newer DEPS named. So this is the next step's input, not a
# reason to stop.
#
# NOTHING IS LOOSENED BY PASSING HERE. `apply.sh` checks `git status
# --porcelain` itself, with no `--ignore-submodules`, after the sync has had
# its turn — see packages/domicile-engine/scripts/apply.sh — and refuses the
# tree if any of this survived. This step defers; it does not forgive.
#
# AND THE DEFERRAL IS NOT A HOLE: a dep out of step excuses the dep, and
# nothing else in the tree. Anything that is not the sync's to fix still stops
# the job here, where the diagnostic below can say whose it is — not minutes
# later inside `apply.sh`, which says only "has uncommitted changes".
#
# Three views of the same tree, which is how each class is told from the
# others. `--ignore-submodules` is the one way of the alternatives that needs
# nothing but git's own opinion of the index: `git submodule status` reads
# `.gitmodules` and the submodule config, which a gclient-managed tree does not
# have to have registered, and `git diff --submodule=short` still leaves the
# labeling to a parser. Each view only ever drops lines the wider one has, so
# the differences between them ARE the classes, by construction. `grep -Fxv`
# does the differencing because the runner has grep and no diffutils — no
# `diff`, no `cmp` — and `comm` would want both sides sorted first for no gain.
#
#   dirty  everything
#   atpin  everything except what is inside a dep: a submodule line survives
#          here only when the revision the superproject records for it is not
#          the one checked out, which is what "out of step with the pin" means
#   files  no submodule lines at all, so: ordinary files, and only those
atpin="$(git -C "$CHROMIUM" status --porcelain --untracked-files=all \
  --ignore-submodules=dirty)"
files="$(git -C "$CHROMIUM" status --porcelain --untracked-files=all \
  --ignore-submodules=all)"
deps="$(printf '%s\n' "$atpin" | grep -Fxv -f <(printf '%s\n' "$files") || true)"

# A dep a newer DEPS named and this pin does not, which a sync at that pin
# cloned and left behind. It is a git repository of its own, and `git status
# -uall` prints a nested repository as a directory rather than listing the
# files under it — every other untracked thing is listed file by file. That
# trailing slash is the whole difference, and it is what tells
# `?? third_party/jetstream/v3.0/` apart from somebody's work in progress.
#
# Only these are the sync's. `--delete_unversioned_trees` removes a dep that
# `.gclient_entries` records and the current DEPS does not name; it reads that
# file, not the tree, so it does nothing whatever about a loose file somebody
# wrote. Deferring one of those would move the refusal to `apply.sh` and drop
# every word of advice the diagnostic below gives with it.
clones="$(printf '%s\n' "$files" | grep -E '^\?\? .*/$' || true)"
contamination="$(printf '%s\n' "$files" | grep -Ev '^\?\? .*/$' || true)"

# The file `engine-sync.sh` reads to decide it may skip the sync entirely. Same
# expression as that script's, character for character, so the two cannot
# drift: one clears it and the other reads it, and a path spelled two ways is a
# fast path that skips the sync this step just asked for, silently.
STAMP="${DOMICILE_SYNCED_PIN:-$(dirname "$CHROMIUM")/.domicile-synced-pin}"

if [ -n "$deps" ] && [ -z "$contamination" ]; then
  echo "the DEPS under $CHROMIUM are not at $pin, so engine-sync.sh has work to do:"
  # `sed -n 1,20p` rather than `head -20` for the reason the diagnostic below
  # uses it: under `pipefail` a `head` that closes the pipe early makes the
  # whole block exit 141. With a total on the truncation line, which the
  # diagnostic below never printed: twenty lines out of an unstated number
  # told the runs this was written for nothing about how much of their tree
  # it meant.
  printf '%s\n' "$deps" | sed -n '1,20p' | sed 's/^/  /'
  more="$(printf '%s\n' "$deps" | sed -n '21,$p' | wc -l | tr -d ' ')"
  [ "$more" -eq 0 ] ||
    echo "  ... and $more more ($(printf '%s\n' "$deps" | wc -l | tr -d ' ') in all)"
  echo
  echo "Each is a gitlink — a submodule DEPS names — and not a file anybody"
  echo "edited. \`git reset --hard\` does not touch a submodule's working tree, so"
  echo "this step cannot move them and a \`gclient sync\` at the pin is what does."
  echo "This is what a repin looks like from a branch that has not taken it yet."

  if [ -n "$clones" ]; then
    echo
    echo "And deps this pin does not name, which that sync removes with"
    echo "\`--delete_unversioned_trees\`. Each is a git repository of its own,"
    echo "which is why it is listed as a directory and not file by file:"
    printf '%s\n' "$clones" | sed -n '1,20p' | sed 's/^/  /'
    more="$(printf '%s\n' "$clones" | sed -n '21,$p' | wc -l | tr -d ' ')"
    [ "$more" -eq 0 ] || echo "  ... and $more more"
  fi

  # DEPS STATE IS THE STAMP'S BUSINESS, and `git status` was only ever a proxy
  # for it that happened to correlate until a pin actually moved. The stamp is
  # cleared before a sync and written only after one that finished with HEAD at
  # the pin, so it never describes a tree between two pins — which is why
  # deferring to it is safe. Usually it already names another pin and the fast
  # path would not have fired anyway; where it names this one and the deps are
  # still out of step — a dep moved without a repin — the fast path would skip
  # the one sync this tree needs. Cleared, so it cannot.
  #
  # Only on a real pin mismatch, which is why `atpin` ignores what is inside a
  # dep: a stray object file in one is not a mismatch, `gclient sync --reset`
  # does not pass `--force` and would not remove it, and clearing the stamp for
  # it would buy every build from then on a full sync that fixes nothing.
  rm -f "$STAMP"
  echo
  echo "Cleared $STAMP so the sync cannot take its fast path."
  echo "apply.sh checks this tree again afterward and still refuses a dirty one."
  exit 0
fi

# WHAT A READER NEEDS HERE IS THE CAUSE, NOT THE SYMPTOM. This last fired on a
# pull request that had nothing to do with it, and the reason — `reset --hard`
# leaves untracked files, so another agent's work in progress in the shared
# checkout survives every reset and fails every run after it — had to be
# reconstructed from a comment in a workflow file and a shell loop. It is
# reconstructed here instead, once.
untracked="$(printf '%s\n' "$dirty" | sed -n 's/^?? //p')"
tracked="$(printf '%s\n' "$dirty" | sed -n '/^?? /!p')"

{
  echo "::error::$CHROMIUM is still dirty after the reset, so apply.sh will refuse it"
  echo
  echo "This step reset the tree to $pin and removed every file the series"
  echo "lays down, by name, out of $SERIES."
  echo "What is listed below survived both, which means it is not the series'"
  echo "and not upstream's: it is work somebody left in the shared checkout."
  echo

  if [ -n "$untracked" ]; then
    echo "Untracked — new files. \`git reset --hard\` does not touch these, which"
    echo "is why they survive every reset and fail every run after the first:"
    # `sed -n 1,20p` rather than `head -20`: under `pipefail` a `head` that
    # closes the pipe early makes the whole block exit 141, which would
    # truncate the explanation at the moment there is most of it to give.
    printf '%s\n' "$untracked" | sed -n '1,20p' | sed 's/^/  /'
    left="$(printf '%s\n' "$untracked" | sed -n '21,$p' | wc -l | tr -d ' ')"
    [ "$left" -eq 0 ] || echo "  ... and $left more"
    echo
    echo "Each belongs at the mirrored path under packages/domicile-engine/src/:"
    printf '%s\n' "$untracked" | sed -n '1,5p' |
      sed "s|^|  packages/domicile-engine/src/|"
    echo
    echo "Committed there, it is reset-proof — and this step then removes it"
    echo "from the checkout by name, every run, for free."
    echo
    # THE OTHER THING THIS CAN BE, and it is worth telling apart before
    # anything is deleted. A file laid down by an *earlier run of another
    # branch* looks identical to somebody's work in progress from here: both
    # are untracked, and this checkout cannot see the branch the first one
    # came from. The difference is that one of them is already committed
    # somewhere and the other is the only copy there is.
    echo "One of these is not like the other, so check before removing anything:"
    echo "a path that also exists under packages/domicile-engine/src/ on some"
    echo "other branch is a previous run's, already committed there, and safe to"
    echo "remove from the checkout. Anything else is the only copy of somebody's"
    echo "work and removing it destroys it."
    echo
    echo "This step keeps a manifest of what it lays down ($MANIFEST) so that a"
    echo "previous run's files are removed by name on the next run. A tree from"
    echo "before that manifest existed has to be cleared once by hand."
  fi

  if [ -n "$tracked" ]; then
    echo "Tracked and modified. A path here is one of two things. If it is a"
    echo "dep — a submodule DEPS names — it is either out of step with the pin,"
    echo "which is engine-sync.sh's and would have been deferred to it had the"
    echo "rest of this tree been clean, or dirty in its own working tree, which"
    echo "no sync of ours removes. Otherwise it is an ordinary file, and"
    echo "\`reset --hard\` does restore one of those — so it was written after"
    echo "the reset ran, which most likely means a build or a \`git am\` is in"
    echo "this tree right now:"
    printf '%s\n' "$tracked" | sed -n '1,20p' | sed 's/^/  /'
  fi

  echo
  echo "DO NOT clear this with \`git clean -fdx\`. It is somebody's uncommitted"
  echo "work, and the rest of what it would delete is a four-hour Chromium"
  echo "build's worth of files gclient's hooks put there."
  echo
  echo "The fix is at the other end: commit the files into"
  echo "packages/domicile-engine/src/ and remove them from $CHROMIUM."
  echo "Then re-run this job."
} >&2
exit 1
