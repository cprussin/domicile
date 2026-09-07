#!/usr/bin/env bash
# How `run-engine.sh` decides what a shell is.
#
# The unit is the block that turns its second argument into a page directory.
# There are three answers and they are not interchangeable: a name is a shell
# in this workspace and has to be built, a path is somebody else's and is built
# already, and `DOMICILE_PAGE` is a package handing one in. Getting it wrong
# means either building a shell nobody asked for or serving a directory that is
# not a page — and the second only shows up as a browser on a blank screen,
# which reads as the seam rather than as the argument.
#
# Run out of the real script rather than copied, so a rewrite that moves it
# fails here loudly instead of leaving this passing against a version nobody
# ships.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_UNDER_TEST="$ROOT/scripts/run-engine.sh"

# From the three-things comment to the `esac` that closes the dispatch.
BLOCK="$(awk '/^PAGE_DIR="\$\{DOMICILE_PAGE:-\}"$/,/^fi$/' "$SCRIPT_UNDER_TEST")"
[ -n "$BLOCK" ] || {
  echo "no shell dispatch in $SCRIPT_UNDER_TEST — its markers moved." >&2
  exit 1
}

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

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/built-desktop"
: >"$WORK/built-desktop/index.html"
: >"$WORK/built-desktop/main.js"

# What the block leaves behind, which is all anything downstream reads.
# The block `exit 1`s when it refuses, which ends the subshell it runs in — so
# the report has to be inside that subshell and the refusal read off its status.
# Written the other way round, a refusal printed nothing and the case compared
# two empty strings, which passes for the wrong reason.
dispatch() { # $1 the shell argument, $2 (optional) DOMICILE_PAGE
  local out
  if out="$( (
      ROOT="$ROOT"
      SHELL_ARG="$1"
      DOMICILE_PAGE="${2:-}"
      eval "$BLOCK"
      echo "name=$SHELL_NAME page=${PAGE_DIR:-(build it)}"
    ) 2>/dev/null )"; then
    echo "$out"
  else
    echo "refused"
  fi
}

expect "a workspace name is built, not served" \
  "name=simple page=(build it)" \
  "$(dispatch simple)"

expect "an unknown workspace name is refused" \
  "refused" \
  "$(dispatch nosuchshell)"

# The out-of-tree case, which is the whole reason a path is allowed: a desktop
# built somewhere else, by whatever means, is a directory with an index.html.
expect "a directory is served as it is" \
  "name=built-desktop page=$WORK/built-desktop" \
  "$(dispatch "$WORK/built-desktop")"

# Pointing at the entry point rather than at what contains it. A person who
# knows where their bundle is should not have to know that the thing being
# served is its directory.
expect "a file is served from its directory" \
  "name=built-desktop page=$WORK/built-desktop" \
  "$(dispatch "$WORK/built-desktop/main.js")"

expect "a path to nothing is refused" \
  "refused" \
  "$(dispatch "$WORK/not-here/anything")"

# THE CASE A PACKAGE TAKES. The store path is handed in and the argument is
# only a name — nothing is built and nothing in the workspace is consulted,
# which is what makes `nix run` work with no checkout anywhere.
expect "a handed-in page wins over building a named shell" \
  "name=manganese page=$WORK/built-desktop" \
  "$(dispatch manganese "$WORK/built-desktop")"

# TWO INSTRUCTIONS THAT DISAGREE. Both are somebody saying which page to serve.
# The first version validated the argument and then discarded it, so a run
# could fail because of a path it was never going to use — and, worse, succeed
# while serving a page other than the one typed.
expect "a handed-in page and a path argument is refused" \
  "refused" \
  "$(dispatch "$WORK/built-desktop" "$WORK/built-desktop")"

# A bare name that is also a directory here is a path — `run-engine.sh . dist`
# from inside a shell's source tree. It used to be refused with a sentence
# claiming it was not a path to a built one, which was false and unchecked.
expect "a bare name that is a directory is a path" \
  "name=built-desktop page=$WORK/built-desktop" \
  "$(cd "$WORK" && dispatch built-desktop)"

# And it does not have to be a shell this repository has ever heard of.
expect "a handed-in page needs no workspace shell at all" \
  "name=nosuchshell page=$WORK/built-desktop" \
  "$(dispatch nosuchshell "$WORK/built-desktop")"

# `.` is a path, not a name, and a person standing in their build directory
# will type it.
expect "a bare dot is a path" \
  "name=built-desktop page=$WORK/built-desktop" \
  "$(cd "$WORK/built-desktop" && dispatch .)"

# THE USER'S OWN `cd` IS NOT AN ARGUMENT. A packaged desktop sets the page and
# passes its own name for the log, so `nix run github:cprussin/domicile#simple`
# arrives here as `simple` with a page already handed in. Run from a directory
# that happens to hold a `simple/`, the bare-name-is-a-directory rule turned
# that word into a path and the whole command was refused for naming two pages
# — one of which the user never set and one of which they were not talking
# about. Reproduced before it was fixed; there is no path in that command line.
mkdir -p "$WORK/cwd-with-a-desktop-in-it/simple"
expect "a name that matches a directory here is still a name once a page is given" \
  "name=simple page=$WORK/built-desktop" \
  "$(cd "$WORK/cwd-with-a-desktop-in-it" && dispatch simple "$WORK/built-desktop")"

# And the case the refusal was actually written for, which still refuses: a
# path really is a second answer to the question `DOMICILE_PAGE` already
# answered, and a slash is what makes it one whatever is in the working
# directory.
expect "a page and a slashed path are still two instructions" \
  "refused" \
  "$(cd "$WORK/cwd-with-a-desktop-in-it" && dispatch ./simple "$WORK/built-desktop")"

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
