#!/usr/bin/env bash
# Everything that can be checked here, in one command.
#
#   nix develop .#full -c ./scripts/check.sh
#   ./scripts/check.sh e2e            # one group
#
# The groups are `shell`, `rust`, `typescript`, `e2e`, `engine` and `nix`.
# Every one of them is what a workflow runs — `.github/workflows/` names
# groups and nothing else, which is what
# `scripts/test-the-workflows-delegate-their-checks.sh` is there to keep true.
# The last two need something most machines do not have and say so rather than
# failing: `engine` a warm Chromium tree, `nix` a `nix` on PATH.
#
# `DOMICILE_CHECK_STRICT=1` turns a skip into a failure. Locally a missing
# tool is a fact about the machine; in CI it is a check that silently stopped
# running, which is the worst outcome a check can have.
#
# There are a dozen checks across two languages and a handful of e2e scripts,
# and until this existed each one was something the person working had to
# remember, set up and run. That went wrong in the ordinary ways: a worktree
# with no `node_modules` failing three suites that looked like regressions, a
# stale X socket with no server behind it reading as a crash in the code. None
# of those are findings, and all of them cost more than the checks did.
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

PASSED=(); FAILED=(); SKIPPED=()

# Which groups to run. Naming none runs them all — the thing to reach for by
# default, and what a bare `check` means.
#
# Not `GROUPS`: bash owns that name (it is the caller's group ids) and assigning
# to it does nothing, silently, so every group read as unwanted and the script
# cheerfully checked nothing at all.
KNOWN=(shell rust typescript e2e engine nix)
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
#
# EXCEPT A PASS'S OWN WORDS. A check that says what it established does it on a
# `PASS:` line, and those — and nothing else of its log — are printed under its
# `ok`. Without them a pass was one word: PR #586's backdrop-filter run went
# green as `engine-guard-css-and-resize ok`, and nothing in the job said the
# run had happened at all. Every one of them, not the last: a guard and its
# control are two claims, and the css guard's is three.
run() {
  local name="$1"; shift
  local log; log="$(mktemp)"
  label "$name"
  "$@" >"$log" 2>&1
  verdict "$name" "$?" "$log"
}

# The engine group's scripts at once, as noise, then their verdicts in order.
# Waits on its own PIDs only: a bare `wait` would also wait on the e2e group's
# Xvfb.
run_together() {
  local dir script pids=(); dir="$(mktemp -d)"
  for script in "$@"; do
    ( engine_noisy "$script" >"$dir/$(basename "$script")" 2>&1
      echo $? >"$dir/$(basename "$script").status" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  for script in "$@"; do
    label "$(basename "$script" .sh)"
    verdict "$(basename "$script" .sh)" "$(cat "$dir/$(basename "$script").status")" \
      "$dir/$(basename "$script")"
  done
  rm -rf "$dir"
}

verdict() {
  local name="$1" status="$2" log="$3"
  if [ "$status" -eq 0 ]; then
    echo "ok"
    sed -n 's/^ *PASS: /    PASS: /p' "$log"
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

FAILURES="$(mktemp)"
# Where a failing check's whole log is kept. Deliberately not cleaned up: it is
# the thing a reader needs after the run ends, and its whole point is to
# outlive the trap that removes everything else.
# `DOMICILE_CHECK_LOG_DIR` because $TMPDIR is not always somewhere a reader can
# get back to. `engine.yml` runs this as `nix develop .#full --command
# ./scripts/check.sh engine`, and nix gives every `--command` a $TMPDIR of its
# own -- `export NIX_BUILD_TOP="$(mktemp -d ...)"` in makeRcScript -- so the one
# path printed below would name a directory nothing else in that job has. That
# is the mistake lib-control-budget.sh made with the control budgets and paid
# for over two engine runs: a file written where nothing reads it, silently.
# The default is unchanged for every other caller.
KEEP_LOGS="${DOMICILE_CHECK_LOG_DIR:-${TMPDIR:-/tmp}}/domicile-check-logs"
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
#
# Only for the groups that read `node_modules`, and that is not fastidiousness:
# `cargo-test.yml` and `nix-build.yml` run on `ubuntu-latest` with no bun set
# up, because nothing they check needs one. An unconditional install there is
# an `exit 1` before a single check has run, and the words it exits with —
# "dependencies would not install" — describe a broken lockfile rather than a
# runner that was never going to have bun on it.
needs_node_modules() {
  for group in typescript e2e engine shell; do wanted "$group" && return 0; done
  return 1
}
if needs_node_modules; then
  label "bun install"
  if bun install --frozen-lockfile >/dev/null 2>&1; then echo "ok"; else
    echo "FAILED"; echo "dependencies would not install" >&2; exit 1
  fi
fi

# ---- the checks -----------------------------------------------------------

# Every `test-*.sh`, for the
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
  # The one step in this group that LINKS, which is the one that can fail for
  # a reason that is nothing to do with the code — see `lib/rust-check.sh`.
  #
  # A SUBSHELL BODY, `( )` and not `{ }`, because `require_linkable_libraries`
  # ends its caller and `run` calls what it is given in this shell. A `{ }`
  # here would exit `check.sh` itself, taking every later group with it and
  # printing no table at all.
  cargo_test() (
    . "$ROOT/scripts/lib/rust-check.sh"
    require_linkable_libraries
    # `--no-fail-fast`, because without it cargo stops at the first failing
    # target and says nothing about the rest. A tree that breaks two test
    # binaries then reports whichever sorts first, and the second failure is
    # invisible until the first is fixed — which is how a mutation measurement
    # taken with this gate came out reading "killed by one file" when two
    # killed it.
    cargo test --workspace --no-fail-fast
  )
  run "cargo test" cargo_test
fi

if wanted typescript; then
  echo
  echo "== typescript =="
  run "biome" bunx biome check .
  run "turbo test" bun run turbo test
fi

# Every `nix-*.sh`, for the reason the other globs take everything they match.
# A group of its own rather than more `test-*.sh` because these need `nix` and
# the `shell` group must not: `e2e.yml` runs that group on `ubuntu-latest`
# under `DOMICILE_CHECK_STRICT=1`, where a skip is fatal, so one check in there
# that cannot run without nix would make six expected skips the price of
# keeping the job green — and a long allow-list is how a real skip stops being
# noticed.
if wanted nix; then
  echo
  echo "== nix =="
  for script in scripts/nix-*.sh; do
    run "$(basename "$script" .sh)" "$script"
  done
fi

# THE ONE GROUP WITH AN ORDER AND A FAIL-FAST, and both are about the same
# thing: every check in it wants the Chromium tree on `crux`, which is one
# machine with one job slot and a build measured in hours. The cheap checks go
# first — a stat, then two gtest runs — because a run that has already found
# the symbol missing should not then spend the ten minutes of guards that
# follow photographing pixels to say so again, which is what the workflow steps
# this replaced did by aborting the job.
#
# Written out rather than globbed, which every other group here refuses to do.
# The reason a glob is right elsewhere is that a check added and not run is the
# same as one never written — and that is still true, so
# `scripts/test-the-workflows-delegate-their-checks.sh` asserts this list holds
# every `scripts/engine-*.sh` there is. The order is the thing a glob cannot
# carry; completeness is the thing a list cannot, so each is kept where it
# works.
if wanted engine; then
  echo
  echo "== engine =="
  # A skip is not a stop: on a machine with no tree every one of these skips,
  # and bailing on the first would report one skip where there are nineteen —
  # which under STRICT is one failure naming one check instead of the list of
  # what is not running.
  engine_stop() {
    [ "${#FAILED[@]}" -eq 0 ] && return 1
    echo "  (stopping: the tree is one slot, and the rest would measure a build already known bad)"
  }
  # AS NOISE, every check but latency: another run's latency guard waits until
  # none of this is running rather than timing a machine it loads. Only when
  # the job names itself -- `engine.yml` sets `CARD_OWNER` -- because the
  # registry is on `crux`'s /build, which a person's machine has no reason to
  # have. Latency itself is not noise, or it would wait out its own run.
  engine_noisy() {
    if [ -n "${CARD_OWNER:-}" ]; then
      "$ROOT/.github/scripts/engine-render-node-lock.sh" noisy "$CARD_OWNER" -- "$@"
    else
      "$@"
    fi
  }
  engine_serial() {
    local script
    for script in "$@"; do
      run "$(basename "$script" .sh)" engine_noisy "$script"
      engine_stop && return 1
    done
    return 0
  }
  # TOGETHER: headless, no card, and no port, broker, profile or log in
  # common, so they overlap; serially they were most of this group's time.
  # Latency stays after them because it times things.
  engine_serial \
    scripts/engine-build-produced-what-the-guards-load.sh \
    scripts/engine-unit-tests.sh \
    scripts/engine-drm-unit-tests.sh \
    scripts/engine-build-the-compositor.sh \
    scripts/engine-guard-shortcuts-inhibitor.sh \
    scripts/engine-guard-client-window.sh \
    scripts/engine-guard-two-windows.sh \
    scripts/engine-guard-shell.sh \
    scripts/engine-guard-shell-manganese.sh \
    scripts/engine-guard-shell-shortcuts.sh &&
  { run_together \
      scripts/engine-guard-webview-framing.sh \
      scripts/engine-guard-webview-keyboard.sh \
      scripts/engine-guard-webview-escape.sh \
      scripts/engine-guard-webview-history.sh \
      scripts/engine-guard-webview-click.sh \
      scripts/engine-guard-webview-new-window.sh \
      scripts/engine-guard-webview-routed-link.sh \
      scripts/engine-guard-control-arrival.sh
    ! engine_stop; } &&
  engine_serial scripts/engine-guard-css-and-resize.sh &&
  run engine-guard-latency scripts/engine-guard-latency.sh &&
  engine_serial scripts/engine-guard-shortcuts-inhibitor-chord.sh
  # The chord last, because what it can fail on is the host honoring the
  # inhibitor rather than the build, and a failure here is no reason to stop
  # the guards that read the build — which a place above them would do.
fi

if wanted e2e; then
echo
echo "== end to end =="
# Every `e2e-*.sh` there is, rather than a list to keep in step with the
# directory. A check added and not run is the same as one that was never
# written.
for script in scripts/e2e-*.sh; do
  name="$(basename "$script" .sh)"
  # No display case any more: the two checks that needed one were the two that
  # drove `--present`, and both went with it. What is left runs headless, which
  # is what the compositor now is.
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
