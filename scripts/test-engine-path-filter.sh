#!/usr/bin/env bash
# Which files put a four-hour Chromium build in front of a change, asserted.
#
# `engine.yml` is the most expensive thing in this repository. It runs on
# `crux`, which has ONE job slot, and a run holds that slot from
# `actions/checkout` to the `if: always()` drop — so every run of it is time
# nothing else on that machine can have. An incremental build is ~27m in
# practice and a pin roll is four hours. Its `paths:` filter is therefore not
# housekeeping: it is the only thing standing between an unrelated commit and
# that queue.
#
# A path filter has two ways to be wrong and they fail in opposite directions:
#
#   - too wide, and a file the job cannot read costs the slot anyway. That is
#     `engine-release.nix`, which is generated, contains a commit, a url and a
#     hash, and names which published tarball `nix build .#engine` fetches.
#     `engine.yml` never reads it: it resets /build/chromium/src to
#     `CHROMIUM_PIN` and applies `patches/` over it. A repin is three lines
#     that cannot change what that build produces, and it was costing two full
#     builds — one on the pull request, one on the merge to main.
#
#   - too narrow, and a real engine source reaches main without the pixel
#     guard ever looking at it. That is the worse failure and the harder one to
#     notice, because the missing check does not go red: it does not appear.
#     This repository has shipped three checks that could not fail and is
#     sensitive about it; a filter that silently excludes `patches/` is the
#     same mistake in workflow form.
#
# So both directions are asserted here, and the exclusions are asserted to be
# EXACTLY as narrow as they claim: `packages/domicile-engine/other.nix` still
# triggers, which is what distinguishes "this one generated file" from an
# `*.nix` exclusion somebody widened later.
#
# AND THE THING THAT MAKES THE EXCLUSION SAFE IS IN ANOTHER FILE, so it is
# asserted here too. Excluding the pin from the engine build is only correct
# while something else proves a new hash actually resolves — a url under a tag
# that was deleted, or a hash off by a byte, is a flake that cannot be built
# and every open pull request goes red for a reason none of them caused.
# `nix-build.yml` is that something: it builds `.#manganese` and `.#simple`,
# which reach `domicileEngine`, which is `fetchurl` of exactly that url and
# hash. It carries no `paths:` at all, and the moment it grows one this
# exclusion stops being safe. That is the last check below.
#
# Read against GitHub's filter rules: patterns are evaluated in order and the
# LAST one matching a file decides, `!` negates, `*` stops at a `/` and `**`
# does not. Nothing here depends on the one corner of those rules that is
# genuinely ambiguous — whether `a/**/b` matches `a/b` with no directory
# between — so no assertion below is made about a file at the package root
# whose only match would be the `**/*.md` exclusion. The load-bearing patterns
# are a literal path, a trailing `/**`, and a single-star basename, and all
# three read the same way under either reading.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
ENGINE="$WORKFLOWS/engine.yml"
NIX_BUILD="$WORKFLOWS/nix-build.yml"
[ -f "$ENGINE" ] || { echo "no $ENGINE" >&2; exit 1; }
[ -f "$NIX_BUILD" ] || { echo "no $NIX_BUILD" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# The `paths:` list of one event out of a workflow's top-level `on:` block, one
# pattern per line.
#
# By indentation, because that is what the YAML means and a `grep` for `- ` in
# this file would also collect the `branches:` list and every path named in a
# comment. The block runs from `on:` to the next column-zero key; an event is
# two spaces in, its `paths:` four, and its entries six. Comment lines are
# skipped without disturbing the state, since `engine.yml` has more comment
# than filter.
paths_for() { # workflow, event
  awk -v want="$2" '
    /^on:/ { in_on = 1; next }
    in_on && /^[^[:space:]]/ { in_on = 0 }
    !in_on { next }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    # A two-space key: the event. Leaving any paths list we were in.
    /^  [^[:space:]]/ { event = $0; sub(/^  /, "", event); sub(/:.*/, "", event); in_paths = 0; next }
    # A four-space key: `paths:` or something beside it.
    /^    [^[:space:]-]/ { key = $0; sub(/^    /, "", key); sub(/:.*/, "", key)
                           in_paths = (key == "paths" && event == want); next }
    in_paths && /^      - / {
      value = $0
      sub(/^      - /, "", value)
      sub(/[[:space:]]*$/, "", value)
      # Quotes are how a pattern starting with `!` gets past the YAML parser,
      # and they are not part of the pattern.
      gsub(/^"|"$/, "", value)
      gsub(/^'"'"'|'"'"'$/, "", value)
      print value
    }
  ' "$1"
}

# One GitHub filter pattern as an extended regular expression.
#
# The order is the whole trick: every `**` form has to be taken out of the way
# before `*` is rewritten, or `[^/]*` lands inside what was a globstar. They
# come back at the end, which is why the placeholders are spelled with `@` —
# nothing in a path pattern contains one, and nothing in a regex does either.
glob_to_regex() {
  printf '%s' "$1" | sed \
    -e 's/[.^$+(){}|]/\\&/g' \
    -e 's/\[/\\[/g' \
    -e 's/\]/\\]/g' \
    -e 's|\*\*/|@GLOBSTARSLASH@|g' \
    -e 's|/\*\*|@SLASHGLOBSTAR@|g' \
    -e 's|\*\*|@GLOBSTAR@|g' \
    -e 's|\*|[^/]*|g' \
    -e 's|?|[^/]|g' \
    -e 's|@GLOBSTARSLASH@|(.*/)?|g' \
    -e 's|@SLASHGLOBSTAR@|/.*|g' \
    -e 's|@GLOBSTAR@|.*|g'
}

# Whether a path would trigger a workflow carrying these patterns.
#
# LAST MATCH WINS, which is GitHub's rule and the reason the exclusions in
# `engine.yml` are written after the include they narrow. A path matching
# nothing is not included; a path matched by an include and then by a later
# `!` is excluded; a path matched by a `!` and then by a later include is back
# in. Anything else here would be a different filter engine than the one that
# decides, which would make this file a guard against nothing.
included() { # path, pattern...
  local path="$1"; shift
  local verdict=1 pattern negated regex
  for pattern in "$@"; do
    negated=0
    case "$pattern" in
      (!*) negated=1; pattern="${pattern#!}" ;;
    esac
    regex="$(glob_to_regex "$pattern")"
    if printf '%s\n' "$path" | grep -qE "^${regex}$"; then
      verdict=$((negated))
    fi
  done
  return "$verdict"
}

# A file this repository actually has, because a guard whose subjects are
# invented reads the same whether or not the tree still looks like that. A
# rename that moves the patch series out from under the filter has to fail
# here, and it can only fail here if the path came from the tree.
real() { # path
  [ -e "$ROOT/$1" ] || {
    fail "$1 is a file this repository has" \
      "it is not in the tree, so the assertion below about it proves nothing"
    return 1
  }
  return 0
}

triggers() { # label, path, pattern...
  local label="$1" path="$2"; shift 2
  if included "$path" "$@"; then
    ok "$label"
  else
    fail "$label" "$path matches no pattern, so a change to it would not be built"
  fi
}

does_not_trigger() { # label, path, pattern...
  local label="$1" path="$2"; shift 2
  if included "$path" "$@"; then
    fail "$label" "$path is included, so a change to it takes the crux slot for a build that cannot read it"
  else
    ok "$label"
  fi
}

echo "engine.yml"

push_paths="$(paths_for "$ENGINE" push)"
pr_paths="$(paths_for "$ENGINE" pull_request)"

if [ -n "$push_paths" ]; then
  ok "the push filter was read at all"
else
  fail "the push filter was read at all" \
    "on.push.paths in engine.yml is empty or unparsed; nothing below asserted anything"
  echo "$FAILED failed"
  exit 1
fi

# THE TWO LISTS ARE ONE LIST. A file in the pull request's filter and not in
# the push's is proved before it merges and never again; a file in the push's
# and not the pull request's is built only after it is too late to be a review.
# Either way the answer to "is this change built" depends on which event asked,
# and that is not a thing anybody can hold in their head. They are written out
# twice because GitHub's parser does not resolve YAML anchors, which is a
# reason to assert they agree rather than a reason to let them drift.
if [ "$push_paths" = "$pr_paths" ]; then
  ok "push and pull_request filter the same paths"
else
  fail "push and pull_request filter the same paths" \
    "the two lists differ, so whether a change is built depends on which event asked"
fi

# One pattern per element. Read a line at a time rather than split on `IFS`,
# because a path pattern is free to contain a glob and an unquoted expansion
# here would let the shell match it against this checkout — which is a
# different question than the one being asked.
patterns=()
while IFS= read -r pattern; do
  patterns+=("$pattern")
done <<EOF
$push_paths
EOF

# --- too wide ---------------------------------------------------------------

does_not_trigger "a repin does not build the engine" \
  packages/domicile-engine/engine-release.nix "${patterns[@]}"

real packages/domicile-engine/upstream/setoverridechildpaintflags.md &&
  does_not_trigger "prose under the package does not build the engine" \
    packages/domicile-engine/upstream/setoverridechildpaintflags.md "${patterns[@]}"

# --- too narrow -------------------------------------------------------------

# The series itself, whatever it is called today. `patches/` is what
# `apply.sh` feeds to `git am` and the only reason this job exists.
patch="$(cd "$ROOT" && ls packages/domicile-engine/patches/*.patch 2>/dev/null | head -1)"
if [ -n "$patch" ]; then
  triggers "a patch builds the engine" "$patch" "${patterns[@]}"
else
  fail "a patch builds the engine" "no patches under packages/domicile-engine/patches"
fi

real packages/domicile-engine/CHROMIUM_PIN &&
  triggers "the Chromium pin builds the engine" \
    packages/domicile-engine/CHROMIUM_PIN "${patterns[@]}"

real packages/domicile-engine/scripts/apply.sh &&
  triggers "the apply script builds the engine" \
    packages/domicile-engine/scripts/apply.sh "${patterns[@]}"

source_file="$(cd "$ROOT" && find packages/domicile-engine/src -name '*.cc' | head -1)"
if [ -n "$source_file" ]; then
  triggers "a fork source file builds the engine" "$source_file" "${patterns[@]}"
else
  fail "a fork source file builds the engine" "no .cc under packages/domicile-engine/src"
fi

real .github/workflows/engine.yml &&
  triggers "the workflow builds the engine" \
    .github/workflows/engine.yml "${patterns[@]}"

# The steps of this job are these scripts, so a change to one is a change to
# the job. Without them the first thing to find out would be a release.
step_script="$(cd "$ROOT" && ls .github/scripts/engine-*.sh 2>/dev/null | head -1)"
if [ -n "$step_script" ]; then
  triggers "a step script builds the engine" "$step_script" "${patterns[@]}"
else
  fail "a step script builds the engine" "no .github/scripts/engine-*.sh"
fi

# --- exactly as narrow as it says -------------------------------------------

# Not a file in the tree, and that is the point: this asserts the SHAPE of the
# exclusion rather than its effect on today's checkout. If somebody ever writes
# `!packages/domicile-engine/**/*.nix` because it looked like the same thing,
# a second .nix file added under that package would stop being built and
# nothing would say so. Here, it fails.
triggers "the exclusion is one generated file and not every .nix" \
  packages/domicile-engine/other.nix "${patterns[@]}"

# And the same for prose: a `!packages/domicile-engine/**` that overshot would
# still pass every exclusion assertion above.
triggers "the exclusions did not swallow the package" \
  packages/domicile-engine/scripts/build.sh "${patterns[@]}"

# --- what makes excluding the pin safe --------------------------------------

echo "nix-build.yml"

# `nix build .#manganese .#simple` reaches `domicileEngine`, which is a
# `fetchurl` of the url and hash in `engine-release.nix`. It is the only check
# that resolves a repin at all, and it can only be that while it runs on
# everything: a `paths:` here — however reasonable the day somebody adds one —
# would leave a repin proved by nothing, since engine.yml no longer looks at
# it.
nix_push="$(paths_for "$NIX_BUILD" push)"
nix_pr="$(paths_for "$NIX_BUILD" pull_request)"
if [ -z "$nix_push" ] && [ -z "$nix_pr" ]; then
  ok "nix-build.yml still runs on every change, so a repin is proved by it"
else
  fail "nix-build.yml still runs on every change, so a repin is proved by it" \
    "it now has a paths filter, and engine.yml no longer builds on a repin — the pin would be proved by nothing"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
