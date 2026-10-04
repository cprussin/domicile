#!/usr/bin/env bash
# Tests `engine-job-tmp.sh`, which gives each engine job a temp directory that
# is removed when the job ends.
#
# Nix creates a `nix-shell.XXXXXX` directory for every `nix-shell` and
# `nix develop` and does not remove it here: `nix develop` has no cleanup, and
# Chromium's buildFHSEnv shellHook `exec`s bwrap before `nix-shell`'s EXIT trap
# can run. These filled /build/tmp on `crux`. Each job points TMPDIR at its own
# directory and drops it in an `if: always()` step.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JOB_TMP="$ROOT/.github/scripts/engine-job-tmp.sh"
[ -x "$JOB_TMP" ] || { echo "no $JOB_TMP" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'chmod -R u+w "$WORK"; rm -rf "$WORK"' EXIT
mkdir -p "$WORK/tmp"

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
there() { [ -e "$1" ] && echo yes || echo no; }

# --- one directory per job, under the unit's TMPDIR -------------------------

MINE="$(TMPDIR="$WORK/tmp" "$JOB_TMP" make)"
THEIRS="$(TMPDIR="$WORK/tmp" "$JOB_TMP" make)"
expect "a job's temp directory is under the unit's TMPDIR" "$WORK/tmp" \
  "$(dirname "$MINE")"
expect "and named so the room check knows whose kind it is" dj \
  "$(basename "$MINE" | cut -d. -f1)"

# Chrome's process singleton binds
# `$TMPDIR/.org.chromium.Chromium.XXXXXX/SingletonSocket` and dies if the path
# exceeds a Unix socket's 107 bytes. Nested nix shells under this directory
# exceed it, so spike.sh starts Chrome with TMPDIR on /tmp.
socket="/build/tmp/$(basename "$MINE")/nix-shell.XXXXXX/nix-shell-4194304-4294967295/.org.chromium.Chromium.XXXXXX/SingletonSocket"
expect "a nested nix-shell under it is too deep for Chrome's socket" too-deep \
  "$([ "${#socket}" -gt 107 ] && echo too-deep || echo fits)"
SPIKE="$ROOT/packages/domicile-engine/scripts/spike.sh"
expect "so spike.sh starts Chrome with TMPDIR on /tmp" yes \
  "$(grep -qE '^TMPDIR=/tmp "\$OUT/chrome"' "$SPIKE" && echo yes || echo no)"
expect "and it exists" yes "$(there "$MINE")"
expect "two jobs get two" yes "$([ "$MINE" != "$THEIRS" ] && echo yes || echo no)"

# --- dropped with what nix left in it ---------------------------------------

# Store copies keep read-only modes, which stop a plain `rm -rf`.
mkdir -p "$MINE/nix-shell.abcdef/store-copy"
: >"$MINE/nix-shell.abcdef/store-copy/rc"
chmod a-w "$MINE/nix-shell.abcdef/store-copy"
: >"$THEIRS/live"
"$JOB_TMP" drop "$MINE"
expect "dropping it removes it, read-only insides and all" no "$(there "$MINE")"
expect "and leaves another job's alone" yes "$(there "$THEIRS/live")"

# --- and only ever a job's ---------------------------------------------------

# The path comes through $GITHUB_ENV and is `rm -rf`'d, so refuse anything
# that is not a job's temp directory.
mkdir -p "$WORK/tmp/not-a-job"
if "$JOB_TMP" drop "$WORK/tmp/not-a-job" 2>/dev/null; then
  expect "a path that is not a job's temp directory is refused" refused ok
else
  expect "a path that is not a job's temp directory is refused" refused refused
fi
expect "and left where it was" yes "$(there "$WORK/tmp/not-a-job")"

# --- the jobs this exists for ------------------------------------------------

# Each `crux` job must make its directory before entering a nix shell and drop
# it in a step that always runs.
for flow in engine.yml engine-release.yml engine-drm-probe.yml; do
  file="$ROOT/.github/workflows/$flow"
  MAKE="$(grep -n 'engine-job-tmp.sh make' "$file" | head -1 | cut -d: -f1)"
  NIX="$(grep -nE 'nix-shell |nix develop |engine-sync.sh|engine-build-in-shell.sh' "$file" |
    grep -v '^[0-9]*: *#' | head -1 | cut -d: -f1)"
  DROP="$(grep -n 'engine-job-tmp.sh drop' "$file" | head -1 | cut -d: -f1)"
  if [ -n "$MAKE" ] && [ -n "$NIX" ] && [ "$MAKE" -lt "$NIX" ]; then
    printf '  ok    %s makes its temp directory before any nix shell\n' "$flow"
  else
    printf '  FAIL  %s makes its temp directory before any nix shell\n    make: %s nix: %s\n' \
      "$flow" "${MAKE:-none}" "${NIX:-none}"
    FAILED=$((FAILED + 1))
  fi
  if [ -n "$DROP" ] && sed -n "$((DROP - 2)),$((DROP - 1))p" "$file" | grep -q 'always()'; then
    printf '  ok    and drops it even when the job failed or was canceled\n'
  else
    printf '  FAIL  and drops it even when the job failed or was canceled\n    drop: %s\n' \
      "${DROP:-none}"
    FAILED=$((FAILED + 1))
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
