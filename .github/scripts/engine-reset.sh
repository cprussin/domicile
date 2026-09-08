#!/usr/bin/env bash
# Put the shared Chromium checkout back to the pin, so `apply.sh` will take it.
#
# Both engine workflows do this and they must do it identically: `engine.yml`
# before every proof build, `engine-release.yml` before every published one.
# It was written twice, the two copies drifted in the order of their steps, and
# a third copy is what this file exists to prevent.
#
#   .github/scripts/engine-reset.sh /build/chromium/src
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
    echo "Tracked and modified — edits to upstream files that are not in the"
    echo "series. \`reset --hard\` should have restored these, so something wrote"
    echo "them after it ran, which most likely means a build or a \`git am\` is"
    echo "in this tree right now:"
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
