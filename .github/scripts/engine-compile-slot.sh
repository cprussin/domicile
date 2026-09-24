#!/usr/bin/env bash
# One Chromium compile at a time on this machine.
#
#   .github/scripts/engine-compile-slot.sh take <owner>
#   .github/scripts/engine-compile-slot.sh drop <owner>
#   .github/scripts/engine-compile-slot.sh warm <chromium/src>
#   .github/scripts/engine-compile-slot.sh built <chromium/src>
#
# `warm` writes `warm=true` to $GITHUB_OUTPUT only if `built` last recorded
# this applied series built by these build scripts: a tree can carry the series
# with its out/Release cold.
#
# The tree pool gives two runs two trees so that a repin stops blocking every
# other engine branch. It does not give them a second machine: `crux` has 62G
# and `swapDevices = []` (cprussin/dotfiles: config/machines/crux), and a cold
# Chromium build's link step is most of that. Two at once is an OOM kill on the
# machine that serves the house its DNS.
#
# So this is the memory the pool cannot split, and only a run that is going to
# compile takes it -- a run whose tree already carries the series compiles
# nothing and must not queue behind one that does. That pair is the whole
# design: warm runs keep shipping while a repin builds.
#
# IT WAITS, UP TO DOMICILE_COMPILE_SLOT_WAIT SECONDS (30 minutes), then
# refuses. With the compiler cache a series change compiles in minutes, so
# refusing outright turned every overlap of two engine PRs into a red job to
# re-run. A repin's cold build still outlasts the wait and still refuses.
#
# AND NOTHING STEALS IT ON AGE. A cold build is up to five hours, and clearing
# this while its holder is linking is the OOM it exists to prevent.
set -u

usage() {
  echo "usage: $(basename "$0") <take|drop|who> [owner]" >&2
  echo "       $(basename "$0") <warm|built> <chromium/src>" >&2
  exit 2
}

action="${1:-}"
owner="${2:-}"
[ -n "$action" ] || usage

# Under /build, because `PrivateTmp` gives each runner unit its own /tmp and a
# lock between two runners cannot be in one of them. Override for tests.
LOCK="${DOMICILE_COMPILE_SLOT:-/build/.domicile-compile-slot}"

HERE="$(cd "$(dirname "$0")" && pwd)"
built_stamp() { echo "${DOMICILE_BUILT_STAMP:-$(dirname "$owner")/.domicile-built}"; }
# The series stamp, not just the series: it names the commit the apply made,
# so a re-apply whose build died is not warm.
build_identity() {
  { cat "${DOMICILE_SERIES_STAMP:-$(dirname "$owner")/.domicile-series-stamp}" 2>/dev/null
    sha256sum "$HERE/engine-build.sh" "$HERE/engine-release-build.sh" | cut -d' ' -f1
  } | sha256sum | cut -d' ' -f1
}

age() {
  local since now secs
  since="$(cat "$LOCK/since" 2>/dev/null || true)"
  case "$since" in
    (*[!0-9]*|'') echo "unknown age (no readable timestamp in it)"; return ;;
  esac
  now="$(date +%s)"
  secs=$((now - since))
  [ "$secs" -ge 0 ] || { echo "unknown age (its timestamp is in the future)"; return; }
  if [ "$secs" -lt 3600 ]; then
    echo "held for $((secs / 60))m"
  else
    echo "held for $((secs / 3600))h $(((secs % 3600) / 60))m"
  fi
}

holder() {
  cat "$LOCK/owner" 2>/dev/null || echo "someone who did not write their name in it"
}

case "$action" in
  take)
    [ -n "$owner" ] || usage
    wait_for="${DOMICILE_COMPILE_SLOT_WAIT:-1800}"
    started="$(date +%s)"
    took=""
    while :; do
      mkdir "$LOCK" 2>/dev/null && { took=1; break; }
      [ $(($(date +%s) - started)) -lt "$wait_for" ] || break
      [ -n "${announced:-}" ] || {
        echo "waiting up to ${wait_for}s for '$(holder)' to finish compiling"
        announced=1
      }
      sleep "${DOMICILE_COMPILE_SLOT_POLL:-10}"
    done
    if [ -n "$took" ]; then
      echo "$owner" >"$LOCK/owner"
      date +%s >"$LOCK/since"
      date -Is >"$LOCK/since-human"
      echo "took the compile slot as '$owner'"
      exit 0
    fi
    {
      echo "::error::'$(holder)' is still compiling Chromium here ($(age)); waited ${wait_for}s, so this run will not start a second one"
      echo "The slot is at $LOCK, taken $(cat "$LOCK/since-human" 2>/dev/null || echo 'at an unrecorded time')."
      echo
      echo "This machine has 62G and no swap. Two cold Chromium builds in it is"
      echo "an OOM kill, and this machine is also the house's DNS."
      echo
      echo "Once that build is done, re-run this job -- a repin is up to four"
      echo "hours, which is longer than this waits."
      echo
      echo "If the holder is a run that died, nothing clears this but a person:"
      echo
      echo "  rm -rf $LOCK"
    } >&2
    exit 1
    ;;

  drop)
    [ -n "$owner" ] || usage
    # Idempotent, and it has to be: this runs from an `if: always()` step, so
    # it is also reached by a warm run that never took it and by one that
    # failed to.
    [ -d "$LOCK" ] || { echo "no compile slot to drop"; exit 0; }
    held="$(holder)"
    if [ "$held" != "$owner" ]; then
      # Unconditional removal here would let a third run start compiling beside
      # the holder, which is the thing this prevents, reached through it.
      echo "left the compile slot alone: it belongs to '$held', not to '$owner'"
      exit 0
    fi
    rm -rf "$LOCK"
    echo "dropped the compile slot"
    ;;

  who)
    if [ -d "$LOCK" ]; then
      echo "Chromium is being compiled here by '$(holder)' ($(age))"
    else
      echo "nobody is compiling here"
    fi
    ;;

  warm)
    [ -n "$owner" ] || usage
    warm=false
    [ -f "$owner/${OUT_RELEASE:-out/Release}/args.gn" ] &&
      [ "$(cat "$(built_stamp)" 2>/dev/null)" = "$(build_identity)" ] && warm=true
    echo "warm=$warm" >>"${GITHUB_OUTPUT:-/dev/stdout}"
    ;;

  built)
    [ -n "$owner" ] || usage
    build_identity >"$(built_stamp)"
    ;;

  *) usage ;;
esac
