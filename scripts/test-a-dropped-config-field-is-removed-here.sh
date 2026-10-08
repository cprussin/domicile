#!/usr/bin/env bash
# Tests that a top-level config field `domicile-config` stops parsing is listed
# in `removedSettings` in `nix/home-manager.nix`.
#
# Every config struct is `deny_unknown_fields`, so dropping a field makes every
# config that still sets it a desk that will not start. `removedSettings` turns
# that into a home-manager assertion that says where the setting went.
#
# Compares `Config` against the base: `DOMICILE_PR_BASE_SHA` on a pull request
# (`e2e.yml` sets it), else the merge base with `origin/main`, else `HEAD^`.
# Exits 77 when the base cannot be fetched.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODULE="$ROOT/nix/home-manager.nix"
LIB=packages/domicile-config/src/lib.rs
cd "$ROOT"

# Whether `git` has the commit `$1`.
have() { git cat-file -e "$1^{commit}" 2>/dev/null; }

base() {
  if [ -n "${DOMICILE_PR_BASE_SHA:-}" ]; then
    have "$DOMICILE_PR_BASE_SHA" || git fetch -q --depth=1 origin "$DOMICILE_PR_BASE_SHA" 2>/dev/null
    echo "$DOMICILE_PR_BASE_SHA"
    return
  fi
  local merge_base
  merge_base="$(git merge-base HEAD origin/main 2>/dev/null)"
  if [ -n "$merge_base" ] && [ "$merge_base" != "$(git rev-parse HEAD)" ]; then
    echo "$merge_base"
    return
  fi
  have HEAD^ || git fetch -q --depth=2 origin "$(git rev-parse HEAD)" 2>/dev/null
  git rev-parse -q --verify HEAD^ 2>/dev/null
}

BASE="$(base)"
if [ -z "$BASE" ] || ! have "$BASE"; then
  echo "SKIP: no base commit to compare $LIB against"
  exit 77
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The `pub` fields of `pub struct Config`, sorted.
config_fields() {
  awk '
    /^pub struct Config \{/ { inside = 1; next }
    inside && /^\}/ { exit }
    inside && match($0, /^    pub [a-z_]+:/) { print substr($0, RSTART + 8, RLENGTH - 9) }
  ' | sort
}

git show "$BASE:$LIB" | config_fields >"$WORK/base"
config_fields <"$LIB" >"$WORK/head"

# The names in the module's `removedSettings = { ... };`.
awk '
  /^  removedSettings = \{$/ { inside = 1; next }
  inside && /^  \};$/ { exit }
  inside && match($0, /^    [a-z_]+ =/) { print substr($0, RSTART + 4, RLENGTH - 6) }
' "$MODULE" | sort >"$WORK/removed"

FAILED=0
for side in base head removed; do
  [ -s "$WORK/$side" ] || {
    printf '  FAIL  read nothing from the %s side, so its pattern no longer matches\n' "$side"
    FAILED=1
  }
done

unlisted="$(comm -23 "$WORK/base" "$WORK/head" | comm -23 - "$WORK/removed" | tr '\n' ' ')"
if [ -n "$unlisted" ]; then
  printf '  FAIL  domicile-config no longer parses these, and removedSettings does not list them: %s\n' "$unlisted"
  printf '        a config that sets one stops the desk; list it with where it went\n'
  FAILED=1
fi

parsed="$(comm -12 "$WORK/head" "$WORK/removed" | tr '\n' ' ')"
if [ -n "$parsed" ]; then
  printf '  FAIL  removedSettings lists these, and domicile-config still parses them: %s\n' "$parsed"
  FAILED=1
fi

[ "$FAILED" -eq 0 ] || exit 1
echo "ok: Config at $(git rev-parse --short "$BASE") and here, $(wc -l <"$WORK/removed" | tr -d ' ') removed"
