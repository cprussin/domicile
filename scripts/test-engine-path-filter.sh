#!/usr/bin/env bash
# Asserts which paths trigger `engine.yml`.
#
# `engine.yml` runs on `crux`, which has one job slot. An incremental build
# takes ~27m and a pin roll four hours, so the `paths:` filter decides what
# queues behind that slot. Both failure directions are checked:
#
#   - Too wide: a file the build never reads takes the slot.
#     `engine-release.nix` is generated and only names the published tarball;
#     the build applies `patches/` over `CHROMIUM_PIN` and ignores it.
#   - Too narrow: an engine source reaches main without the pixel guard. No
#     check goes red; the check just does not run.
#
# The exclusions are checked to be as narrow as they claim, and `nix-build.yml`
# is checked to have no `paths:` filter, since it is the only check that
# resolves a repinned url and hash.
#
# GitHub filter rules: the last matching pattern wins, `!` negates, `*` stops
# at `/` and `**` does not. No assertion depends on whether `a/**/b` matches
# `a/b`, which GitHub leaves ambiguous.
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

# Prints one event's `paths:` patterns from a workflow's top-level `on:` block,
# one per line.
#
# Parses by indentation: a plain `grep` for `- ` would also collect
# `branches:` entries and paths named in comments. Events are indented two
# spaces, `paths:` four, entries six.
paths_for() { # workflow, event
  awk -v want="$2" '
    /^on:/ { in_on = 1; next }
    in_on && /^[^[:space:]]/ { in_on = 0 }
    !in_on { next }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    # A two-space key is an event; it ends any paths list.
    /^  [^[:space:]]/ { event = $0; sub(/^  /, "", event); sub(/:.*/, "", event); in_paths = 0; next }
    # A four-space key is `paths:` or a sibling key.
    /^    [^[:space:]-]/ { key = $0; sub(/^    /, "", key); sub(/:.*/, "", key)
                           in_paths = (key == "paths" && event == want); next }
    in_paths && /^      - / {
      value = $0
      sub(/^      - /, "", value)
      sub(/[[:space:]]*$/, "", value)
      # Quotes let a pattern start with `!` in YAML; they are not part of it.
      gsub(/^"|"$/, "", value)
      gsub(/^'"'"'|'"'"'$/, "", value)
      print value
    }
  ' "$1"
}

# Converts one GitHub filter pattern to an extended regular expression.
#
# Every `**` form is replaced with an `@` placeholder before `*` is rewritten,
# so `[^/]*` cannot land inside a globstar. Paths and regexes never contain `@`.
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

# Whether a path triggers a workflow with these patterns.
#
# Follows GitHub's rule: the last matching pattern wins, and a path matching
# nothing is excluded.
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

# Fails unless the path exists in the tree, so a rename that moves files out
# from under the filter fails here instead of passing against an invented path.
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

# The push and pull_request lists must match, or whether a change is built
# depends on the event. GitHub does not resolve YAML anchors, so the list is
# written twice.
if [ "$push_paths" = "$pr_paths" ]; then
  ok "push and pull_request filter the same paths"
else
  fail "push and pull_request filter the same paths" \
    "the two lists differ, so whether a change is built depends on which event asked"
fi

# Read line by line instead of splitting on `IFS`: an unquoted expansion would
# glob the patterns against this checkout.
patterns=()
while IFS= read -r pattern; do
  patterns+=("$pattern")
done <<EOF
$push_paths
EOF

# --- too wide ---------------------------------------------------------------

does_not_trigger "a repin does not build the engine" \
  packages/domicile-engine/engine-release.nix "${patterns[@]}"

# The production engine's pin, committed to main after each official build.
# The build does not read it.
does_not_trigger "the official engine's repin does not build the engine" \
  packages/domicile-engine/engine-official.nix "${patterns[@]}"

real packages/domicile-engine/upstream/setoverridechildpaintflags.md &&
  does_not_trigger "prose under the package does not build the engine" \
    packages/domicile-engine/upstream/setoverridechildpaintflags.md "${patterns[@]}"

# --- too narrow -------------------------------------------------------------

# `patches/` is what `apply.sh` feeds to `git am`.
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

# The job's steps are these scripts.
step_script="$(cd "$ROOT" && ls .github/scripts/engine-*.sh 2>/dev/null | head -1)"
if [ -n "$step_script" ]; then
  triggers "a step script builds the engine" "$step_script" "${patterns[@]}"
else
  fail "a step script builds the engine" "no .github/scripts/engine-*.sh"
fi

# The checks the job runs: `scripts/engine-*.sh`, the guard library
# `scripts/lib/engine-guard.sh`, and the runner `scripts/check.sh`. Editing them
# changes what the job proves, so they must trigger it.
engine_check="$(cd "$ROOT" && ls scripts/engine-*.sh 2>/dev/null | head -1)"
if [ -n "$engine_check" ]; then
  triggers "an engine check builds the engine" "$engine_check" "${patterns[@]}"
else
  fail "an engine check builds the engine" "no scripts/engine-*.sh"
fi

real scripts/lib/engine-guard.sh &&
  triggers "the guard library builds the engine" \
    scripts/lib/engine-guard.sh "${patterns[@]}"

real scripts/check.sh &&
  triggers "the runner builds the engine" scripts/check.sh "${patterns[@]}"

# Other checks under `scripts/` run on `ubuntu-latest` and must not take the
# `crux` slot. This catches a widening to `scripts/**`.
does_not_trigger "an unrelated check does not build the engine" \
  scripts/test-american-english.sh "${patterns[@]}"

does_not_trigger "a nix check does not build the engine" \
  scripts/nix-the-shells-build.sh "${patterns[@]}"

# --- exactly as narrow as it says -------------------------------------------

# A path not in the tree: this checks the exclusion's shape. A widening to
# `!packages/domicile-engine/**/*.nix` would stop building any new .nix file
# under the package.
triggers "the exclusion is one generated file and not every .nix" \
  packages/domicile-engine/other.nix "${patterns[@]}"

# Catches a `!packages/domicile-engine/**` that would still pass the exclusion
# checks above.
triggers "the exclusions did not swallow the package" \
  packages/domicile-engine/scripts/build.sh "${patterns[@]}"

# --- the production build does not start itself ---------------------------

echo "engine-release.yml"

# The release workflow commits the official pin to main. If it ever runs on a
# branch push, that file must be excluded, or each release starts the next one.
RELEASE_FLOW="$WORKFLOWS/engine-release.yml"
release_branches="$(awk '
  /^on:/ { in_on = 1; next }
  in_on && /^[^[:space:]]/ { in_on = 0 }
  in_on && /^  push:/ { in_push = 1; next }
  in_on && /^  [^[:space:]]/ { in_push = 0 }
  in_push && /^    branches:/ { print }
' "$RELEASE_FLOW")"
release_patterns=()
while IFS= read -r pattern; do
  [ -n "$pattern" ] && release_patterns+=("$pattern")
done <<EOF
$(paths_for "$RELEASE_FLOW" push)
EOF
if [ -z "$release_branches" ]; then
  ok "landing the official pin does not start another release (no branch push)"
elif [ "${#release_patterns[@]}" -gt 0 ]; then
  does_not_trigger "landing the official pin does not start another release" \
    packages/domicile-engine/engine-official.nix "${release_patterns[@]}"
else
  fail "landing the official pin does not start another release" \
    "engine-release.yml runs on a branch push with no paths filter"
fi

# --- what makes excluding the pin safe --------------------------------------

echo "nix-build.yml"

# `nix build .#manganese .#simple` fetches the url and hash in
# `engine-release.nix`. It is the only check that resolves a repin, so it must
# run on every change.
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
