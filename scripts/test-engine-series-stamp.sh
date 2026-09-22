#!/usr/bin/env bash
# When the shared checkout already holds the series, asserted.
#
# `engine.yml` resets /build/chromium/src to the pin and applies `patches/`
# over it before every build. That is right when the series has moved and it is
# pure cost when it has not: `git reset --hard` followed by `git am` rewrites
# every patched file whether or not its content changed, and the build behind
# it is measured in tens of minutes on the one machine that can run it.
#
# So the tree writes down what it is carrying, and a run whose series matches
# skips the reset, the apply and — because nothing moved — the compile.
# `engine-sync.sh` already works this way for the DEPS; this is the same idea
# one step along, and the same file layout beside the checkout.
#
# THE WHOLE RISK IS A FALSE POSITIVE, so that is what this file is mostly
# about. Skipping the reset when the tree is NOT in the state the stamp claims
# means building something other than this pull request and reporting it as
# this pull request — a green check on code that was never compiled, which is
# the one failure this repository cares most about. Every way the tree can
# differ therefore has a case below, and each of them must come out `false`:
#
# - the patch series changed (a patch edited, added or removed);
# - a file under `src/` changed, or went missing from the checkout;
# - `CHROMIUM_PIN` moved;
# - HEAD moved — somebody built by hand, or another workflow reset the tree;
# - the checkout picked up a tracked modification, or an untracked file that is
#   not the series'.
#
# The true case gets one assertion and the false cases get eleven, and that
# ratio is deliberate: being wrong in the `true` direction costs a wrong green,
# and being wrong in the `false` direction costs exactly what today costs.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP_SH="$ROOT/.github/scripts/engine-series-stamp.sh"
[ -x "$STAMP_SH" ] || { echo "no $STAMP_SH" >&2; exit 1; }

command -v git >/dev/null || { echo "  SKIP: no git"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# A repository shaped like this one: the script at the path whose `../..` is
# the root, and the series it reads relative to itself.
FAKE="$WORK/repo"
mkdir -p "$FAKE/.github/scripts" \
         "$FAKE/packages/domicile-engine/patches" \
         "$FAKE/packages/domicile-engine/src/components/domicile"
cp "$STAMP_SH" "$FAKE/.github/scripts/"

TREE="$WORK/chromium/src"
mkdir -p "$TREE"
git -C "$TREE" init -q
git -C "$TREE" config user.email ci@domicile.invalid
git -C "$TREE" config user.name "domicile CI"
echo "upstream" >"$TREE/upstream.cc"
git -C "$TREE" add -A
git -C "$TREE" commit -qm "upstream"
PIN="$(git -C "$TREE" rev-parse HEAD)"

{ echo "# what the series is against"; echo "$PIN"; } \
  >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
echo "a patch" >"$FAKE/packages/domicile-engine/patches/0001-first.patch"
echo "laid down" >"$FAKE/packages/domicile-engine/src/components/domicile/thing.cc"

export DOMICILE_SERIES_STAMP="$WORK/.domicile-series-stamp"

# What a successful `apply.sh` leaves behind: a commit over the pin for the
# patch, and the `src/` files copied in and left untracked. Built by hand here
# rather than by running the real thing, because what this script reads is the
# SHAPE of that result and not how it was produced.
apply_series() {
  cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
     "$TREE/components/domicile/thing.cc" 2>/dev/null || {
    mkdir -p "$TREE/components/domicile"
    cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
       "$TREE/components/domicile/thing.cc"
  }
  echo "patched" >>"$TREE/upstream.cc"
  git -C "$TREE" add upstream.cc
  git -C "$TREE" commit -qm "domicile: the series"
}
reset_series() {
  git -C "$TREE" reset -q --hard "$PIN"
  rm -rf "$TREE/components"
}

stamp() { "$FAKE/.github/scripts/engine-series-stamp.sh" "$@" 2>&1; }

# The answer, off the same $GITHUB_OUTPUT the workflow reads rather than off
# the prose: a step's `if:` is decided by that file and by nothing else, so a
# script that printed the right sentence and wrote the wrong key would pass a
# test that read stdout and fail in CI.
carries() {
  local out
  out="$WORK/gh-output"
  : >"$out"
  GITHUB_OUTPUT="$out" "$FAKE/.github/scripts/engine-series-stamp.sh" \
    carries "$TREE" >"$WORK/last-said" 2>&1
  sed -n 's/^carries=//p' "$out" | head -1
}
said() { cat "$WORK/last-said"; }

expect() { # what, want, got
  if [ "$3" = "$2" ]; then ok "$1"; else
    fail "$1" "wanted: $2
    got:    $3"
  fi
}
contains() { # what, needle, haystack
  case "$3" in
    (*"$2"*) ok "$1" ;;
    (*) fail "$1" "expected to mention: $2
    said: $3" ;;
  esac
}

expect_carries() { # what, want
  local got
  got="$(carries)"
  if [ "$got" = "$2" ]; then ok "$1"; else
    fail "$1" "wanted carries=$2, got carries=${got:-<nothing>}
    it said: $(said)"
  fi
}

# --- nothing written down yet ------------------------------------------------

apply_series
expect_carries "a checkout with no stamp beside it is not trusted" false

# --- recorded, and untouched -------------------------------------------------

stamp record "$TREE" >/dev/null
expect_carries "a checkout carrying exactly the recorded series is taken" true

# --- the series moved --------------------------------------------------------

echo "a second patch" >"$FAKE/packages/domicile-engine/patches/0002-second.patch"
expect_carries "a patch added to the series is not what the checkout carries" false
rm "$FAKE/packages/domicile-engine/patches/0002-second.patch"
expect_carries "and removing it again brings it back" true

echo "edited" >>"$FAKE/packages/domicile-engine/patches/0001-first.patch"
expect_carries "a patch edited in place is not what the checkout carries" false
echo "a patch" >"$FAKE/packages/domicile-engine/patches/0001-first.patch"
expect_carries "and putting it back brings it back" true

echo "different" \
  >"$FAKE/packages/domicile-engine/src/components/domicile/thing.cc"
expect_carries "a src/ file edited in the repository is not what the checkout carries" false
echo "laid down" \
  >"$FAKE/packages/domicile-engine/src/components/domicile/thing.cc"
expect_carries "and putting it back brings it back" true

# --- the pin moved -----------------------------------------------------------

{ echo "# what the series is against"; echo "0000000000000000000000000000000000000000"; } \
  >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
expect_carries "a repin is not what the checkout carries" false
{ echo "# what the series is against"; echo "$PIN"; } \
  >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
expect_carries "and putting the pin back brings it back" true

# --- the checkout moved ------------------------------------------------------

# THE CASE THE STAMP ALONE CANNOT SEE. `engine-release.yml` and
# `engine-drm-probe.yml` reset this same tree, and a person on `crux` builds in
# it by hand. The stamp would still name this series; HEAD would not be the one
# it was written against.
git -C "$TREE" commit -q --allow-empty -m "somebody else was here"
expect_carries "a checkout whose HEAD moved is not trusted" false
git -C "$TREE" reset -q --hard HEAD~1
expect_carries "and going back to the recorded commit brings it back" true

echo "somebody's work in progress" >"$TREE/upstream.cc"
expect_carries "a tracked file modified in the checkout is not trusted" false
git -C "$TREE" checkout -q -- upstream.cc
expect_carries "and restoring it brings it back" true

echo "left behind" >"$TREE/stray.cc"
expect_carries "an untracked file that is not the series' is not trusted" false
rm "$TREE/stray.cc"
expect_carries "and removing it brings it back" true

# A src/ file that the series lays down but the checkout no longer has. It is
# untracked, so `git status` says nothing about it going missing and only a
# file-by-file comparison can see it.
rm "$TREE/components/domicile/thing.cc"
expect_carries "a series file missing from the checkout is not trusted" false
cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
   "$TREE/components/domicile/thing.cc"
expect_carries "and putting it back brings it back" true

echo "tampered" >"$TREE/components/domicile/thing.cc"
expect_carries "a series file changed in the checkout is not trusted" false
cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
   "$TREE/components/domicile/thing.cc"
expect_carries "and restoring it brings it back" true

# --- a repository this cannot read ------------------------------------------

# WHOSE ERROR THIS IS. A checkout with no `CHROMIUM_PIN` is broken, and
# `engine-reset.sh` is the step that says so -- it names the file, says where
# the value came from and what to do about it. This step runs before that one,
# so failing here would replace that diagnostic with one from a script whose
# job is to answer a question. It answers `false`, the reset runs, and the
# reset explains.
mv "$FAKE/packages/domicile-engine/CHROMIUM_PIN" "$WORK/pin-elsewhere"
expect_carries "a checkout with no CHROMIUM_PIN is not trusted" false
# On STDOUT, deliberately. Asserting on the combined stream passes whether the
# script says this or merely lets `grep` leak "No such file or directory" from
# inside the identity computation -- which is what it used to do, and which
# reads like a diagnostic without being one.
case "$(sed -n '/^the checkout does not carry/p' "$WORK/last-said")" in
  (*CHROMIUM_PIN*) ok "and it says which file it could not read" ;;
  (*) fail "and it says which file it could not read" "it said: $(said)" ;;
esac
mv "$WORK/pin-elsewhere" "$FAKE/packages/domicile-engine/CHROMIUM_PIN"
expect_carries "and putting it back brings it back" true

# --- the tools this is allowed to assume ------------------------------------

# THE RUNNER HAS COREUTILS AND NOT MUCH ELSE. `cmp` is diffutils, which is not
# on that unit's PATH -- the module supplies bash, coreutils, git, tar, gzip
# and nix, and cprussin/dotfiles adds curl, gawk, jq, lsb-release, python3,
# which, xz and zstd. It does not add diffutils.
#
# This is not a hypothetical. Run 35475442242 failed in exactly this way:
#
#   engine-series-stamp.sh: line 131: cmp: command not found
#   ::error::refusing to write down a series this checkout is not carrying
#
# and the reason it is worth a case of its own rather than a one-word fix is
# the SHAPE of the failure. A missing tool exits 127, a differing file exits 1,
# and the comparison read both as "differs" -- so a tool that was never there
# was indistinguishable from a checkout that had been tampered with, and the
# `carries` side would have answered `false` for ever without anybody
# noticing. A guard whose absence looks exactly like the thing it guards
# against is worse than no guard.
#
# Simulated rather than described: `cmp` is shadowed with a stub that exits 127
# the way a missing command does, and the answers must not change.
NOCMP="$WORK/no-cmp"
mkdir -p "$NOCMP"
printf '#!/bin/sh\nexit 127\n' >"$NOCMP/cmp"
chmod +x "$NOCMP/cmp"
PATH="$NOCMP:$PATH"

expect_carries "a checkout carrying the series is taken without cmp on PATH" true

echo "different in the checkout" >"$TREE/components/domicile/thing.cc"
expect_carries "and a file that really differs is still caught without cmp" false
cp "$FAKE/packages/domicile-engine/src/components/domicile/thing.cc" \
   "$TREE/components/domicile/thing.cc"
expect_carries "and restoring it brings it back" true

out="$(stamp record "$TREE")" && status=0 || status=$?
expect "recording works without cmp on PATH" 0 "$status"

# --- recording refuses to write down a tree it cannot vouch for --------------

# A stamp is only worth what the `record` that wrote it checked. This runs
# straight after the apply step, so the tree should be exactly what the apply
# left -- and if it is not, writing the stamp anyway would arm a false positive
# for the NEXT run rather than failing this one.
reset_series
out="$(stamp record "$TREE")" && status=0 || status=$?

# IT REFUSES TO WRITE AND IT DOES NOT FAIL THE JOB, and the difference is the
# whole of what this step is worth. Not writing the stamp already prevents the
# false positive -- the next run resets and applies, which is what every run
# did before any of this existed. Failing the step on top of that skips the
# build and every guard behind it, which turns "the saving did not apply this
# time" into a red pull request. Run 35475442242 did exactly that: `cmp` was
# missing, nothing was written -- correctly -- and a 35-patch series that had
# just applied cleanly never got compiled.
expect "refusing to record does not fail the run" 0 "$status"
contains "and it says so loudly anyway" "::warning::" "$out"
expect_carries "and nothing it wrote can make the next run skip" false

# WHAT THE SERIES IS, NAMED, AND WHY IT IS THIS SCRIPT THAT SAYS SO.
#
# `engine-release-publish.sh` tags each published engine after the series it
# was built from rather than after the domicile commit that happened to
# produce it, so that two commits which do not touch the fork map to the same
# engine and need no repin between them. That tag and this stamp have to mean
# the same thing by construction: if the release's idea of "the same series"
# were computed anywhere else, the two could drift and the drift would show up
# as a repin that changed nothing, or -- worse -- as no repin for a change
# that did.
#
# So the identity is read out of the one function that already decides it.
out="$(stamp identity)"
expect "the identity is a sha256, and nothing else on the line" ok \
  "$(printf '%s' "$out" | grep -qE '^[0-9a-f]{64}$' && echo ok || echo "said: $out")"

# It is a fact about this repository's series, not about any checkout, which
# is what lets a job on `ubuntu-latest` compute it without /build.
expect "it needs no checkout to answer" "$out" "$(stamp identity)"

# THE TWO DIRECTIONS THAT MATTER. Moving the pin has to move it -- a repin
# rebuilds the most and is the change most likely to be waved through -- and
# moving a patch has to move it too, since that is what a release is FOR.
cp "$FAKE/packages/domicile-engine/CHROMIUM_PIN" "$WORK/pin.bak"
echo "0000000000000000000000000000000000000000" \
  >"$FAKE/packages/domicile-engine/CHROMIUM_PIN"
expect "moving the pin is a different series" ok \
  "$([ "$(stamp identity)" != "$out" ] && echo ok || echo "it did not move")"
cp "$WORK/pin.bak" "$FAKE/packages/domicile-engine/CHROMIUM_PIN"
expect "and putting it back is the same series again" "$out" "$(stamp identity)"

echo "another patch" >"$FAKE/packages/domicile-engine/patches/0002-second.patch"
expect "adding a patch is a different series" ok \
  "$([ "$(stamp identity)" != "$out" ] && echo ok || echo "it did not move")"
rm -f "$FAKE/packages/domicile-engine/patches/0002-second.patch"

# AND THE ONE THAT WOULD BE SILENT. `src/` is copied into the checkout rather
# than applied, so a change there rejects nothing and fails at the compiler
# four hours later. A release keyed on an identity blind to it would publish
# the old engine under a tag claiming the new series.
echo "edited" >>"$FAKE/packages/domicile-engine/src/components/domicile/thing.cc"
expect "editing a laid-down file is a different series" ok \
  "$([ "$(stamp identity)" != "$out" ] && echo ok || echo "it did not move")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
