# Picks the engine build a guard runs against, and runs a guard with its
# control.
#
# Checks in `check.sh`'s `engine` group run against one of three builds:
#
#   the warm tree's `out/Domicile`   `engine.yml`, the dev build on `crux`
#   `out/Release-staged`             `engine-release.yml`, the release tarball
#                                    unpacked into the tree
#   a store path (an out directory)  `pinned-engine.yml`, the pinned engine
#
# Guards take the engine directory as `$1` and the out directory as `OUT`.
# `DOMICILE_CHROMIUM` sets the first and `DOMICILE_ENGINE_OUT` the second.
#
# Each guard's control (`NEGATIVE=1`) runs here rather than in workflow YAML,
# so a guard and its control are one check and a failing control fails it.
# See `packages/domicile-engine/docs/GUARDS.md`.
#
# Sourced. `scripts/test-a-check-that-cannot-run-says-so.sh` tests it.

# The guards ship with the engine package, beside its patch series.
ENGINE_SCRIPTS="$ROOT/packages/domicile-engine/scripts"

# Provides `annotate`, which writes a `::error::` CI annotation so a failure is
# visible outside the long job log.
. "$ENGINE_SCRIPTS/lib-annotate.sh"

# Exit status for a check that could not run, matching `check.sh`. See
# `lib/nix-check.sh` for why each library defines its own.
readonly ENGINE_SKIPPED_STATUS=77

# Sets `ENGINE_DIR` and `ENGINE_OUT`, or exits with a skip naming what is
# missing.
#
# Defaults to the warm tree on `crux`. A missing tree or build is a skip, never
# a pass, since a guard with no engine measures nothing.
require_engine_out() {
  ENGINE_DIR="${DOMICILE_CHROMIUM:-/build/chromium/src}"
  ENGINE_OUT_REL="${DOMICILE_ENGINE_OUT:-out/Domicile}"
  ENGINE_OUT="$ENGINE_DIR/$ENGINE_OUT_REL"

  # Guards read `OUT` relative to their `$1`, so export the relative path.
  # Without it each guard defaults to `out/Domicile`, which is wrong for
  # callers that name another out directory.
  # `scripts/test-a-check-that-cannot-run-says-so.sh` checks the guard sees it.
  export OUT="$ENGINE_OUT_REL"

  [ -d "$ENGINE_DIR" ] || {
    echo "  SKIP: no engine tree at $ENGINE_DIR; set DOMICILE_CHROMIUM"
    exit "$ENGINE_SKIPPED_STATUS"
  }
  [ -d "$ENGINE_OUT" ] || {
    echo "  SKIP: $ENGINE_DIR holds no $ENGINE_OUT_REL; build it with packages/domicile-engine/scripts/build.sh"
    exit "$ENGINE_SKIPPED_STATUS"
  }
}

# Runs a guard, then its control.
#
# Returns non-zero as soon as either fails; the guard's output says which.
# `NEGATIVE=1` selects the control, and each guard's header describes its
# control.
engine_guard_and_control() { # guard script name, args...
  engine_guard "$@" || return
  wants_control || return 0
  NEGATIVE=1 engine_guard "$@"
}

# Whether to run controls. Defaults on, so a caller that forgets still runs
# them.
#
# `pinned-engine.yml` and `engine-release.yml` set `DOMICILE_GUARD_CONTROL=0`:
# `engine.yml` already runs the controls, and a second run doubles the cost.
# `scripts/test-the-workflows-delegate-their-checks.sh` asserts that
# `engine.yml` never opts out.
wants_control() {
  [ "${DOMICILE_GUARD_CONTROL:-1}" != "0" ]
}

# Runs one guard, positive unless `NEGATIVE` is set.
#
# Expects the `.#full` dev shell, which the whole `engine` group shares. It
# provides Chromium's runtime libraries and the GL stack (`engineRuntimeLibs`
# in flake.nix).
engine_guard() { # guard script name, args...
  local guard="$1"; shift
  "$ENGINE_SCRIPTS/$guard" "$ENGINE_DIR" "$@"
}

# Like `engine_guard_and_control`, under a headless wlroots compositor. Guards
# that read a client's pixels need it, because `--ozone-platform=headless`
# cannot import a dmabuf.
engine_guard_and_control_under_wayland() { # guard script name, args...
  engine_guard_under_wayland "$@" || return
  wants_control || return 0
  NEGATIVE=1 engine_guard_under_wayland "$@"
}

# Runs one guard under the compositor, bounded by
# `DOMICILE_ENGINE_CHECK_TIMEOUT` seconds. `check.sh` cannot time the latency
# guard from outside, since it waits for a quiet machine first, and a hung run
# would hold a `crux` runner.
engine_guard_under_wayland() { # guard script name, args...
  local guard="$1" budget="${DOMICILE_ENGINE_CHECK_TIMEOUT:-1800}" status=0; shift
  timeout -k 30 "$budget" "$ENGINE_SCRIPTS/under-wayland.sh" "$ENGINE_DIR" \
    "$ENGINE_SCRIPTS/$guard" "$ENGINE_DIR" "$@" || status=$?
  [ "$status" -ne 124 ] || echo "$guard ran past ${budget}s and was killed"
  return "$status"
}
