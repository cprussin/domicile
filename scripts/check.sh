#!/usr/bin/env bash
# Runs every check in this repository, in one command.
#
#   nix develop .#full -c ./scripts/check.sh
#   ./scripts/check.sh e2e            # one group
#
# Groups: `shell`, `rust`, `typescript`, `e2e`, `nix` and `distro`.
# Workflows run groups only;
# `scripts/test-the-workflows-delegate-their-checks.sh` asserts that. `nix`
# needs `nix` on PATH and `distro` needs packages from `distro/build.sh` and
# docker; without them they skip. The engine's checks are its package's
# `test:engine`.
#
# Each check is reported as `packages/check-runner` reports it; see its README
# for the verdicts and `DOMICILE_CHECK_STRICT`.
#
# It sets up what the checks need (dependencies, tools, a display) and reports
# any check it could not run as skipped, never as passed.
#
# Serial because the e2e scripts share fixed socket paths.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Which groups to run; none means all.
#
# Not `GROUPS`: bash reserves that name and ignores assignments to it.
KNOWN=(shell rust typescript e2e nix distro)
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

# How each check is run and reported, shared with the packages' own checks.
. "$ROOT/packages/check-runner/src/report.sh"
report_start

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
  for group in typescript e2e shell; do wanted "$group" && return 0; done
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

# Every `distro-*.sh`. A separate group because these need the packages
# `distro/build.sh` makes and docker; `distro-packages.yml` runs it.
if wanted distro; then
  echo
  echo "== distro =="
  for script in scripts/distro-*.sh; do
    run "$(basename "$script" .sh)" "$script"
  done
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

report_end
