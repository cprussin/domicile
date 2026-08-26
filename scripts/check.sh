#!/usr/bin/env bash
# Everything that can be checked here, in one command.
#
#   nix run 'github:cprussin/domicile#check'
#   nix develop .#full -c ./scripts/check.sh
#   ./scripts/check.sh e2e            # one group: shell, rust, typescript, e2e
#
# `DOMICILE_CHECK_STRICT=1` turns a skip into a failure. Locally a missing
# Electron is a fact about the machine; in CI it is a check that silently
# stopped running, which is the worst outcome a check can have.
#
# There are a dozen checks across two languages and ten e2e scripts, and until
# this existed each one was something the person working had to remember, set
# up and run. That went wrong in the ordinary ways: a worktree with no
# `node_modules` failing three suites that looked like regressions, an Electron
# nobody could find, a stale X socket with no server behind it reading as a
# crash in the code. None of those are findings, and all of them cost more than
# the checks did.
#
# So this owns the environment as well as the running: it installs what is
# missing, finds what is not on `PATH`, and takes a display of its own. What it
# cannot arrange, it says it skipped and why — a check that did not run must
# never read as one that passed.
#
# Serial on purpose. The e2e scripts each take a fixed `XDG_RUNTIME_DIR` and a
# fixed socket name inside it, so two at once fight over the same paths.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# The sentence this gives when a display does not arrive is the thing a red CI
# run is read for, so it lives in its own file with its own test rather than
# inside a script that runs every check in the repo the moment it is sourced.
# shellcheck source=scripts/xvfb-verdict.sh
. "$ROOT/scripts/xvfb-verdict.sh"
# On the function rather than on the `.`, because the two ways this wire breaks
# fail differently and only one of them is loud. A missing file makes `.`
# return 1 — and `set -e` is not on, so the script carries on to
# `xvfb_verdict: command not found` and reports `could not run: ` with an empty
# reason, which is worse than the `no display` this exists to delete. A file
# that is present but empty or truncated is quieter still: `.` succeeds,
# defines nothing, and says nothing. Asking whether the function is here
# answers both. Nothing else covers it — the test covers `xvfb_verdict` and not
# the loading of it, and a green CI run never reaches the call at all.
declare -F xvfb_verdict >/dev/null || {
  echo "check: no xvfb_verdict — scripts/xvfb-verdict.sh would not load" >&2
  exit 1
}

PASSED=(); FAILED=(); SKIPPED=()

# Which groups to run. Naming none runs them all — the thing to reach for by
# default, and what a bare `check` means.
#
# Not `GROUPS`: bash owns that name (it is the caller's group ids) and assigning
# to it does nothing, silently, so every group read as unwanted and the script
# cheerfully checked nothing at all.
KNOWN=(shell rust typescript e2e)
SELECTED=("$@")
[ "${#SELECTED[@]}" -eq 0 ] && SELECTED=("${KNOWN[@]}")
# Named but unknown is a typo, and a typo that silently selects nothing is the
# `GROUPS` bug with a different trigger: the run checks nothing and exits 0,
# which is the same answer as checking everything and finding it well. CI names
# a group, so this is one rename away from a permanently green job.
for group in "${SELECTED[@]}"; do
  case " ${KNOWN[*]} " in
    *" $group "*) ;;
    *) echo "check: no such group '$group'. Known: ${KNOWN[*]}" >&2; exit 2 ;;
  esac
done
wanted() {
  for group in "${SELECTED[@]}"; do [ "$group" = "$1" ] && return 0; done
  return 1
}

STRICT="${DOMICILE_CHECK_STRICT:-0}"

# Checks the caller already knows cannot run here, space separated. Only
# meaningful under `STRICT`, where it is the difference between "we know this
# runner has no GPU" and "something stopped working" — a blanket strict-off
# cannot tell those apart, and a blanket strict-on makes the first one fatal
# forever. Naming them is what keeps a *new* skip loud.
EXPECTED_SKIPS="${DOMICILE_CHECK_ALLOW_SKIP:-}"

# The status a script exits with to say it could not run — automake's
# convention, and the only way a script can tell us apart from a check that ran
# and passed. Without it a skip is exit 0, which this counted as `ok`: a CI run
# reported `10 passed, 0 failed, 0 skipped` where nine had run and `e2e-dmabuf`
# had bailed in 0.21s for want of a DRM render node.
readonly SKIPPED_STATUS=77

# Everything a check prints goes to a file, and the file is only shown when it
# fails. A green run is a table; a red one is a table and the output of exactly
# the thing that broke.
run() {
  local name="$1"; shift
  local log status; log="$(mktemp)"
  label "$name"
  "$@" >"$log" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "ok"
    PASSED+=("$name")
  elif [ "$status" -eq "$SKIPPED_STATUS" ]; then
    # Its own words for why, because it is the only thing that knows. Printed
    # even though it did not fail: a skip nobody sees is the failure this is
    # here to prevent.
    skip "$name" "$(sed -n 's/^ *SKIP: *//p' "$log" | head -1)"
  else
    echo "FAILED"
    FAILED+=("$name")
    echo "--- $name ---" >>"$FAILURES"
    tail -100 "$log" >>"$FAILURES"
    # And where the rest of it is. A tail is the wrong instrument for a log
    # whose interesting line is at an unknown offset: measured, a TypeScript
    # diagnostic sat behind 105 lines of *passing* output and never appeared.
    # It fits only when turbo's cache is warm, which is never in CI — so the
    # whole log is kept and named rather than trimmed to a guess.
    KEPT="$KEEP_LOGS/$name.log"
    cp "$log" "$KEPT"
    echo "  (the whole log: $KEPT)" >>"$FAILURES"
    echo >>"$FAILURES"
  fi
  rm -f "$log"
}

# The verdict only — `label` has already written the name, whether that was
# `run` before starting the check or a caller that knew before starting it.
# Writing the name here too put it twice on every skipped line: `\r` erases
# nothing in a redirected log, which is where CI reads this.
skip() {
  case " $EXPECTED_SKIPS " in
    *" $1 "*)
      printf 'skipped, as expected here (%s)\n' "$2"
      SKIPPED+=("$1 — expected: $2")
      return
      ;;
  esac
  if [ "$STRICT" = "1" ]; then
    printf 'FAILED (%s)\n' "$2"
    FAILED+=("$1 — could not run: $2")
    echo "--- $1 ---" >>"$FAILURES"
    echo "could not run: $2" >>"$FAILURES"
    echo >>"$FAILURES"
  else
    printf 'skipped (%s)\n' "$2"
    SKIPPED+=("$1 — $2")
  fi
}

# The name, with the verdict still to come on the same line — so a long check
# says what it is doing while it does it.
label() {
  printf '  %-24s ' "$1"
}

# The store's newest electron `bin` directory, or nothing. Sorted on the
# version the path carries rather than on the hash it starts with.
newest_electron() {
  ls -d /nix/store/*-electron-[0-9]*/bin 2>/dev/null |
    sed 's|^.*-electron-\([^/]*\)/bin$|\1\t&|' |
    sort -V | tail -1 | cut -f2
}

FAILURES="$(mktemp)"
# Where a failing check's whole log is kept. Deliberately not cleaned up: it is
# the thing a reader needs after the run ends, and its whole point is to
# outlive the trap that removes everything else.
KEEP_LOGS="${TMPDIR:-/tmp}/domicile-check-logs"
rm -rf "$KEEP_LOGS"; mkdir -p "$KEEP_LOGS"
cleanup() {
  [ -n "${XVFB:-}" ] && kill "$XVFB" 2>/dev/null
  rm -f "$FAILURES" "${DISPLAY_FILE:-}" "${XVFB_LOG:-}"
}
trap cleanup EXIT

# ---- the environment ------------------------------------------------------

echo "== environment =="

# A fresh worktree has no `node_modules`, and the failure that produces is a
# module-resolution error from inside a harness, which reads as a broken
# harness rather than as a missing install.
#
# Every run, not only when the directory is absent. A `node_modules` left over
# from another branch is present and wrong, which is the same staleness the e2e
# scripts rebuild the compositor every run to avoid — and `--frozen-lockfile`
# against an already-satisfied tree is a few hundred milliseconds.
label "bun install"
if bun install --frozen-lockfile >/dev/null 2>&1; then echo "ok"; else
  echo "FAILED"; echo "dependencies would not install" >&2; exit 1
fi

# `nix develop .#full` puts Electron on `PATH`; the bare `.#default` shell does
# not, and neither does a machine that installed one some other way. So this is
# the fallback rather than the normal path — and it is a rough one: `sort -V`
# over the store answers with whatever major happens to be there, which is why
# `.#full` names the version the packages ship rather than leaving it to this.
if ! command -v electron >/dev/null 2>&1; then
  # Newest by version. `tail -1` on the bare glob orders by store *hash*, so
  # with two electrons in the store it picks an arbitrary one.
  ELECTRON_BIN="$(newest_electron)"
  if [ -n "$ELECTRON_BIN" ]; then
    PATH="$ELECTRON_BIN:$PATH"; export PATH
    echo "  electron                 found in the store"
  fi
fi

# Only the e2e scripts want a display, and starting a server the checks will
# never look at is a minute `check.sh rust` can spend on nothing: the one case
# that runs the deadline out is a server that came up alive and silent, and
# that server would hold a group that does not need it for the whole sixty.
if wanted e2e; then

# Why there is no display, for the checks that need one to say instead of
# saying `no display` — which is a restatement of the question. Overwritten the
# moment anything more specific is known.
NO_DISPLAY="no Xvfb on PATH"

# How long Xvfb gets to name a display. It was ten seconds, and a CI run spent
# all ten and failed; `e2e-electron` had the same ten for the same reason and
# missed it on a machine that had just spent a minute compiling. A deadline a
# busy machine misses reports a working environment as broken, which is the
# failure this harness exists to stop producing — and nothing waits this out
# that was going to succeed, because a server that dies is noticed when it
# dies rather than when the clock runs out.
#
# Overridable because sealing it seals the only knob that makes the wait
# observable: walking the outcomes of a server that never answers means not
# waiting a minute for each, and a constant would make that an edit to this
# line rather than a run of the script.
DISPLAY_DEADLINE="${DOMICILE_CHECK_DISPLAY_DEADLINE:-60}"

# A display of our own, chosen by the X server rather than by us. Picking a
# number and hoping is how a stale `/tmp/.X11-unix/X97` — a socket file with no
# server behind it — became an Electron segfault that looked like a bug in the
# shell.
#
# Whatever comes of that, this says so. Printing the line only on success is
# how a CI job came to fail two checks with `could not run: no display` and no
# account of why: Xvfb's output went to `/dev/null`, the environment section
# said nothing at all, and the re-run that passed took the evidence with it. An
# absent line is not a message, and "this machine has no Xvfb" and "the Xvfb it
# has would not start" are not the same fact.
if [ -n "${DISPLAY:-}" ]; then
  echo "  display                  $DISPLAY (the caller's)"
elif ! command -v Xvfb >/dev/null 2>&1; then
  echo "  display                  none — $NO_DISPLAY"
else
  DISPLAY_FILE="$(mktemp)"; XVFB_LOG="$(mktemp)"
  Xvfb -displayfd 3 -screen 0 1280x800x24 3>"$DISPLAY_FILE" >"$XVFB_LOG" 2>&1 &
  XVFB=$!
  # Until it names a display, or dies, or the deadline passes — whichever comes
  # first. The old loop watched only the file, so a server that was already
  # dead cost the full wait and then read exactly like one that was merely slow.
  for _ in $(seq 1 $((DISPLAY_DEADLINE * 10))); do
    [ -s "$DISPLAY_FILE" ] && break
    kill -0 "$XVFB" 2>/dev/null || break
    sleep 0.1
  done
  if [ -s "$DISPLAY_FILE" ]; then
    DISPLAY=":$(tr -d '[:space:]' <"$DISPLAY_FILE")"; export DISPLAY
    echo "  display                  $DISPLAY (ours)"
  else
    # Reported, not retried. The one failure on record threw Xvfb's output
    # away, so nothing here knows what a second attempt would be retrying past;
    # a retry added now would swallow the message that would say. `-displayfd`
    # already rules out the obvious guess — the server picks the number, so
    # this is not a collision with a corpse. Once this line has named a cause,
    # a retry can be aimed at that cause and justified by it.
    NO_DISPLAY="$(xvfb_verdict "$XVFB" "$XVFB_LOG" "$DISPLAY_DEADLINE")"
    echo "  display                  none — $NO_DISPLAY"
  fi
fi

fi  # wanted e2e

# ---- the checks -----------------------------------------------------------

# The harness's own logic, which nothing else covers: `xvfb_verdict` decides
# what a red CI run says about a display that never arrived, and a wrong answer
# there is a wrong answer about every other check. Every `test-*.sh`, for the
# reason the e2e loop takes every `e2e-*.sh` — a check added and not run is the
# same as one that was never written.
if wanted shell; then
  echo
  echo "== shell =="
  for script in scripts/test-*.sh; do
    run "$(basename "$script" .sh)" "$script"
  done
fi

if wanted rust; then
  echo
  echo "== rust =="
  run "cargo fmt" cargo fmt --all --check
  run "cargo clippy" cargo clippy --workspace --all-targets -- -D warnings
  run "cargo test" cargo test --workspace
fi

if wanted typescript; then
  echo
  echo "== typescript =="
  run "biome" bunx biome check .
  run "turbo test" bun run turbo test
fi

if wanted e2e; then
echo
echo "== end to end =="
# Every `e2e-*.sh` there is, rather than a list to keep in step with the
# directory. A check added and not run is the same as one that was never
# written.
for script in scripts/e2e-*.sh; do
  name="$(basename "$script" .sh)"
  case "$name" in
    e2e-electron|e2e-chrome-without-a-host|e2e-shell-launch)
      if ! command -v electron >/dev/null 2>&1; then
        label "$name"; skip "$name" "no electron"; continue
      fi
      if [ -z "${DISPLAY:-}" ]; then
        label "$name"; skip "$name" "$NO_DISPLAY"; continue
      fi
      ;;
    # Each on the binary it actually drives. `weston-flower` used to stand in
    # for "weston is installed", which is a property of one distribution's
    # packaging rather than of what these scripts run — so the guard passed
    # while `e2e-hidpi` and `e2e-input` failed with compositor-shaped verdicts
    # on a missing client. The scripts that own a `77` for their own client
    # (`e2e-slow-chrome`, `e2e-dmabuf`) are left to say so themselves.
    e2e-chrome|e2e-chrome-layer|e2e-two-chromes)
      if ! command -v weston-flower >/dev/null 2>&1; then
        label "$name"; skip "$name" "no weston-flower"; continue
      fi
      ;;
    e2e-input)
      if ! command -v weston-eventdemo >/dev/null 2>&1; then
        label "$name"; skip "$name" "no weston-eventdemo"; continue
      fi
      ;;
    e2e-hidpi)
      if ! command -v weston-terminal >/dev/null 2>&1; then
        label "$name"; skip "$name" "no weston-terminal"; continue
      fi
      ;;
  esac
  run "$name" "$script"
done
fi

# ---- what happened --------------------------------------------------------

echo
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "== what failed =="
  cat "$FAILURES"
fi
echo "== ${#PASSED[@]} passed, ${#FAILED[@]} failed, ${#SKIPPED[@]} skipped =="
# A run that checked nothing is never a pass, whatever the reason — a glob that
# matched no scripts, a group that selected none, an early exit that skipped
# the lot. "Nothing failed" is not the same claim as "something passed".
if [ $(( ${#PASSED[@]} + ${#FAILED[@]} + ${#SKIPPED[@]} )) -eq 0 ]; then
  echo "  and that is a failure: nothing ran."
  exit 1
fi
for one in "${SKIPPED[@]:-}"; do [ -n "$one" ] && echo "  skipped: $one"; done
for one in "${FAILED[@]:-}"; do [ -n "$one" ] && echo "  failed:  $one"; done
[ "${#FAILED[@]}" -eq 0 ]
