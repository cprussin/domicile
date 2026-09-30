#!/usr/bin/env bash
# Which files this repository's series would change in a tree carrying another.
#
# engine.yml's plan guesses how big a run's compile is before it queues, so a
# cold compile does not hold the queue a warm one waits in. That guess needs
# the files the compile would see change: those, and not the patches, decide
# what is rebuilt. A rebased series rewrites every patch and changes no file.
#
# A wrong answer costs a run a slower queue and nothing else, so the cases are
# the ways a file can change and the one way it can look changed and not be.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIFF_SH="$ROOT/.github/scripts/engine-series-diff.sh"
[ -x "$DIFF_SH" ] || { echo "no $DIFF_SH" >&2; exit 1; }

command -v git >/dev/null || { echo "  SKIP: no git"; exit 77; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
expect() { # what, want, got
  if [ "$3" = "$2" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n    wanted: %s\n    got:    %s\n' "$1" "$2" "$3"
    FAILED=$((FAILED + 1))
  fi
}

# A repository shaped like this one: the script where its `../..` is the root.
FAKE="$WORK/repo"
PACKAGE="$FAKE/packages/domicile-engine"
mkdir -p "$FAKE/.github/scripts" "$PACKAGE/patches" "$PACKAGE/src/components/domicile"
cp "$DIFF_SH" "$FAKE/.github/scripts/"
echo "laid down" >"$PACKAGE/src/components/domicile/thing.cc"

TREE="$WORK/chromium/src"
mkdir -p "$TREE"
git -C "$TREE" init -q
git -C "$TREE" config user.email ci@domicile.invalid
git -C "$TREE" config user.name "domicile CI"
printf 'upstream\n' >"$TREE/widely.h"
printf 'upstream\n' >"$TREE/narrow.cc"
printf 'upstream\n' >"$TREE/other.cc"
git -C "$TREE" add -A
git -C "$TREE" commit -qm upstream
PIN="$(git -C "$TREE" rev-parse HEAD)"
{ echo "# what the series is against"; echo "$PIN"; } >"$PACKAGE/CHROMIUM_PIN"

# A series of one commit per file named, each appending <text>, over the pin.
series() { # text, file...
  local text="$1" file
  shift
  git -C "$TREE" reset -q --hard "$PIN"
  for file in "$@"; do
    echo "$text" >>"$TREE/$file"
    git -C "$TREE" commit -qam "domicile: $file"
  done
}
# This repository's series: the commits `series` made, as `patches/`.
publish() { # text, file...
  series "$@"
  rm -f "$PACKAGE/patches/"*
  git -C "$TREE" format-patch -q -o "$PACKAGE/patches" "$PIN"
}
# What a finished apply leaves: the commits, and `src/` copied in.
carry() { # text, file...
  series "$@"
  mkdir -p "$TREE/components/domicile"
  cp "$PACKAGE/src/components/domicile/thing.cc" "$TREE/components/domicile/"
}
changed() { "$FAKE/.github/scripts/engine-series-diff.sh" "$TREE" | tr '\n' ' '; }

publish one narrow.cc widely.h
carry one narrow.cc widely.h
expect "a tree carrying the series changes nothing" "" "$(changed)"

publish one narrow.cc widely.h
carry one narrow.cc
expect "a file the series patches and the tree does not changes" "widely.h " "$(changed)"

publish two narrow.cc widely.h
carry one narrow.cc widely.h
expect "a file the series patches differently changes" "narrow.cc widely.h " "$(changed)"

publish one narrow.cc
carry one narrow.cc other.cc
expect "a file the tree patches and the series does not goes back, which changes it" \
  "other.cc " "$(changed)"

publish one narrow.cc
carry one narrow.cc
echo "laid down again" >"$PACKAGE/src/components/domicile/thing.cc"
expect "a laid-down file that differs changes" "components/domicile/thing.cc " "$(changed)"

echo
if [ "$FAILED" -eq 0 ]; then
  echo "engine-series-diff: all cases passed"
else
  echo "engine-series-diff: $FAILED case(s) failed"
fi
exit "$FAILED"
