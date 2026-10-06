#!/usr/bin/env bash
# Runs every check in this repository, in one command.
#
#   nix develop .#full -c ./scripts/check.sh
#   ./scripts/check.sh e2e            # one group
#
# Groups: `shell`, `rust`, `typescript`, `e2e`, `engine` and `nix`. Workflows
# run groups only; `scripts/test-the-workflows-delegate-their-checks.sh`
# asserts that. `engine` needs a warm Chromium tree and `nix` needs `nix` on
# PATH; without them they skip.
#
# `DOMICILE_CHECK_STRICT=1` turns a skip into a failure, for CI.
#
# It sets up what the checks need (dependencies, tools, a display) and reports
# any check it could not run as skipped, never as passed.
#
# Serial because the e2e scripts share fixed socket paths.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASSED=(); FAILED=(); SKIPPED=()

# Which groups to run; none means all.
#
# Not `GROUPS`: bash reserves that name and ignores assignments to it.
KNOWN=(shell rust typescript e2e engine nix)
SELECTED=("$@")
[ "${#SELECTED[@]}" -eq 0 ] && SELECTED=("${KNOWN[@]}")
# An unknown group is an error, so a typo cannot check nothing and exit 0.
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

# Checks known not to run here, space separated. Under `STRICT`, these may
# skip and any other skip fails.
EXPECTED_SKIPS="${DOMICILE_CHECK_ALLOW_SKIP:-}"

# The exit status a script uses to say it could not run (automake's
# convention). It distinguishes a skip from a pass.
readonly SKIPPED_STATUS=77

# A check's output goes to a file, shown only when it fails. A passing check's
# `PASS:` lines are printed under its `ok`, so a pass says what it established.
run() {
  local name="$1"; shift
  local log; log="$(mktemp)"
  label "$name"
  "$@" >"$log" 2>&1
  verdict "$name" "$?" "$log"
}

# Runs the given engine scripts at once, as noise, then prints their verdicts
# in order. Waits on its own PIDs only: a bare `wait` would also wait on the
# e2e group's Xvfb.
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
    # Its own reason, printed so a skip is visible.
    skip "$name" "$(sed -n 's/^ *SKIP: *//p' "$log" | head -1)"
  else
    echo "FAILED"
    FAILED+=("$name")
    echo "--- $name ---" >>"$FAILURES"
    tail -100 "$log" >>"$FAILURES"
    # Keeps the whole log too: a failure's key line can sit above the tail.
    KEPT="$KEEP_LOGS/$name.log"
    cp "$log" "$KEPT"
    echo "  (the whole log: $KEPT)" >>"$FAILURES"
    echo >>"$FAILURES"
  fi
  rm -f "$log"
}

# Prints the verdict only; `label` already printed the name.
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

# Prints the name and leaves the line open for the verdict, so a long check
# shows what is running.
label() {
  printf '  %-24s ' "$1"
}

FAILURES="$(mktemp)"
# Where a failing check's whole log is kept. Not cleaned up, so it outlives the
# run. `DOMICILE_CHECK_LOG_DIR` lets engine.yml choose a shared path: inside
# `nix develop --command`, $TMPDIR is private to that command.
KEEP_LOGS="${DOMICILE_CHECK_LOG_DIR:-${TMPDIR:-/tmp}}/domicile-check-logs"
rm -rf "$KEEP_LOGS"; mkdir -p "$KEEP_LOGS"
cleanup() {
  [ -n "${XVFB:-}" ] && kill "$XVFB" 2>/dev/null
  rm -f "$FAILURES" "${DISPLAY_FILE:-}" "${XVFB_LOG:-}"
}
trap cleanup EXIT

# ---- the environment ------------------------------------------------------

echo "== environment =="

# Installs dependencies on every run: a missing or stale `node_modules` fails
# in ways that look like broken harnesses. `--frozen-lockfile` on a satisfied
# tree is fast.
#
# Only for groups that read `node_modules`. `cargo-test.yml` and
# `nix-build.yml` run without bun.
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

# Every `test-*.sh`, so a new check cannot be left out.
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
  # The only step here that links, so it can fail for reasons outside the
  # code; see `lib/rust-check.sh`.
  #
  # A subshell `( )`, not `{ }`: `require_linkable_libraries` exits its
  # caller, and `run` calls this in the current shell.
  cargo_test() (
    . "$ROOT/scripts/lib/rust-check.sh"
    require_linkable_libraries
    # `--no-fail-fast` so every failing test binary is reported, not only the
    # first.
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

# Every `nix-*.sh`. A separate group because these need `nix`, and the `shell`
# group runs strict on `ubuntu-latest` without it.
if wanted nix; then
  echo
  echo "== nix =="
  for script in scripts/nix-*.sh; do
    run "$(basename "$script" .sh)" "$script"
  done
fi

# Ordered and fail-fast: every check here uses the one Chromium tree on
# `crux`, so the cheap checks run first and a failure stops the expensive
# guards.
#
# Listed rather than globbed, to keep the order.
# `scripts/test-the-workflows-delegate-their-checks.sh` asserts the list holds
# every `scripts/engine-*.sh`.
if wanted engine; then
  echo
  echo "== engine =="
  # A skip does not stop the group, so a machine with no tree reports every
  # check that did not run.
  engine_stop() {
    [ "${#FAILED[@]}" -eq 0 ] && return 1
    echo "  (stopping: the tree is one slot, and the rest would measure a build already known bad)"
  }
  # Every check but latency runs as noise, so another run's latency guard
  # waits for it. Only when `CARD_OWNER` is set (engine.yml), since the lock
  # registry lives on `crux`. Latency is not noise, or it would wait for itself.
  #
  # Each check has a timeout, so a hung check cannot hold `crux`. The budget
  # is a cold cargo build's. The timeout runs inside `noisy`, so waiting for
  # the card does not count, and it kills the check's whole process group.
  ENGINE_CHECK_TIMEOUT="${DOMICILE_ENGINE_CHECK_TIMEOUT:-1800}"
  engine_noisy() {
    local status
    if [ -n "${CARD_OWNER:-}" ]; then
      "$ROOT/.github/scripts/engine-render-node-lock.sh" noisy "$CARD_OWNER" -- \
        timeout -k 30 "$ENGINE_CHECK_TIMEOUT" "$@"
    else
      timeout -k 30 "$ENGINE_CHECK_TIMEOUT" "$@"
    fi
    status=$?
    [ "$status" -ne 124 ] || echo "$(basename "$1") ran past ${ENGINE_CHECK_TIMEOUT}s and was killed"
    return "$status"
  }
  engine_serial() {
    local script
    for script in "$@"; do
      run "$(basename "$script" .sh)" engine_noisy "$script"
      engine_stop && return 1
    done
    return 0
  }
  # These run together: they are headless and share no card, port, broker,
  # profile or log. Latency runs after them because it measures time.
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
      scripts/engine-guard-shell-local-network.sh \
      scripts/engine-guard-webview-notifications.sh \
      scripts/engine-guard-shell-web-apis.sh \
      scripts/engine-guard-screenshot.sh \
      scripts/engine-guard-webview-content-script.sh \
      scripts/engine-guard-extension-installer.sh \
      scripts/engine-guard-extension-tray.sh \
      scripts/engine-guard-webview-keyboard.sh \
      scripts/engine-guard-webview-escape.sh \
      scripts/engine-guard-webview-browser-page.sh \
      scripts/engine-guard-webview-history.sh \
      scripts/engine-guard-webview-find.sh \
      scripts/engine-guard-webview-click.sh \
      scripts/engine-guard-webview-activate.sh \
      scripts/engine-guard-webview-new-window.sh \
      scripts/engine-guard-webview-routed-link.sh \
      scripts/engine-guard-webview-context-menu.sh \
      scripts/engine-guard-webview-upload.sh \
      scripts/engine-guard-webview-download.sh \
      scripts/engine-guard-webview-save-picker.sh \
      scripts/engine-guard-webview-tabs.sh \
      scripts/engine-guard-webview-active-tab.sh \
      scripts/engine-guard-webview-popup-window.sh \
      scripts/engine-guard-webview-passkey-extension.sh \
      scripts/engine-guard-webview-survives-load-shell.sh \
      scripts/engine-guard-desktop-geometry.sh \
      scripts/engine-guard-windows-state.sh \
      scripts/engine-guard-desk-state.sh \
      scripts/engine-guard-held-moments.sh \
      scripts/engine-guard-asks-promise.sh \
      scripts/engine-guard-shortcut-chords.sh \
      scripts/engine-guard-app-routes-input.sh \
      scripts/engine-guard-shell-handover.sh \
      scripts/engine-guard-shell-script-src.sh
    ! engine_stop; } &&
  engine_serial scripts/engine-guard-css-and-resize.sh &&
  run engine-guard-latency scripts/engine-guard-latency.sh &&
  engine_serial scripts/engine-guard-shortcuts-inhibitor-chord.sh
  # The chord runs last: it can fail because of the host compositor, not the
  # build, and that should not stop the other guards.
fi

if wanted e2e; then
echo
echo "== end to end =="
# Every `e2e-*.sh`, so a new check cannot be left out.
for script in scripts/e2e-*.sh; do
  name="$(basename "$script" .sh)"
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
# A run that checked nothing fails.
if [ $(( ${#PASSED[@]} + ${#FAILED[@]} + ${#SKIPPED[@]} )) -eq 0 ]; then
  echo "  and that is a failure: nothing ran."
  exit 1
fi
for one in "${SKIPPED[@]:-}"; do [ -n "$one" ] && echo "  skipped: $one"; done
for one in "${FAILED[@]:-}"; do [ -n "$one" ] && echo "  failed:  $one"; done
[ "${#FAILED[@]}" -eq 0 ]
