# Which engine a guard is pointed at, and how a guard and its control are run.
#
# Every check in `check.sh`'s `engine` group asserts something about a BUILT
# engine, and there are three different builds they get pointed at:
#
#   the warm tree's `out/Domicile`   — `engine.yml`, the dev build on `crux`
#   `out/Release-staged`             — `engine-release.yml`, a tarball unpacked
#                                      back into the tree, because an artifact
#                                      that cannot show a client's window is
#                                      not a release
#   a store path, which IS an out    — `pinned-engine.yml`, the engine the
#   directory                          checkout pins, so a repin is asserted by
#                                      something other than "it downloaded"
#
# The guards themselves take the directory as `$1` and read `OUT` for the build
# inside it, which is the interface this mirrors rather than invents:
# `DOMICILE_CHROMIUM` is that directory and `DOMICILE_ENGINE_OUT` is that
# `OUT`.
#
# THE CONTROLS ARE HERE AND NOT IN YAML, WHICH IS THE POINT OF THE FILE.
# Fourteen of the sixteen guard checks have one — the same run with the client
# absent, or drawing another color, or with an `<iframe>` in the element's
# place, or with the switch under test left off — and it is
# selected by `NEGATIVE=1` and nothing else. While that lived in a workflow's
# `env:` block, a guard and the only thing establishing that it can fail were
# two steps that merely happened to be adjacent, and neither could be run
# outside CI. Here they are one script and one check: a control that stops
# passing fails the guard it belongs to.
#
# Sourced, and driven directly by
# `scripts/test-a-check-that-cannot-run-says-so.sh`.

# Where the guards and their wrapper live. Not `lib/`: these are the fork's own
# scripts and they ship with the package that carries the patch series.
ENGINE_SCRIPTS="$ROOT/packages/domicile-engine/scripts"

# `annotate`, which is how a guard says where it stopped somewhere a person can
# read it: a job log is a thousand lines of Chromium's startup noise with a
# byte budget on top, and `::error::` becomes an annotation on the check
# instead. The guards already source this; the checks around them should say
# so the same way rather than inventing a second voice.
. "$ENGINE_SCRIPTS/lib-annotate.sh"

# The status a check exits with to say it could not run. See `lib/nix-check.sh`
# for why it is spelled in both.
readonly ENGINE_SKIPPED_STATUS=77

# `ENGINE_DIR` and `ENGINE_OUT`, or a skip that says which is missing.
#
# The default is the warm tree on `crux`, because that is the only machine with
# one and every other caller names its own. A path that is not there, or is
# there with no build in it, is a SKIP and never a pass: a guard whose engine
# does not exist measures nothing, and a check that reports a pass having
# measured nothing is the failure this repository has shipped three times.
require_engine_out() {
  ENGINE_DIR="${DOMICILE_CHROMIUM:-/build/chromium/src}"
  ENGINE_OUT_REL="${DOMICILE_ENGINE_OUT:-out/Domicile}"
  ENGINE_OUT="$ENGINE_DIR/$ENGINE_OUT_REL"

  # AND THE GUARD IS TOLD, which is the whole of this function's contract with
  # it and was missing. `OUT` is the variable every guard reads -- relative to
  # the directory it gets as `$1`, which is why the relative form is exported
  # rather than `ENGINE_OUT`. Resolving the path here and not passing it on left
  # each guard on its own default of `out/Domicile`: invisible for `engine.yml`,
  # whose out directory is exactly that, and fatal for the two callers that name
  # their own. `pinned-engine.yml` passes `.` and run 35552949513 died on
  # `no engine at /nix/store/...-domicile-engine-c92e314/out/Domicile/chrome`,
  # a path that cannot exist; `engine-release.yml` passes `out/Release-staged`
  # and would have gone the same way on the next release.
  #
  # Exported rather than set per invocation, because it is a fact about which
  # build this whole check is reading and every guard in the group reads it the
  # same way. `scripts/test-a-check-that-cannot-run-says-so.sh` asserts the
  # guard's own view of it through a stand-in, since bookkeeping the caller
  # cannot see is not a contract.
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

# A guard, then the control that says the guard can still fail.
#
# Both or neither: a positive run whose control was skipped is a reading nobody
# can act on, so this returns non-zero the moment either does and the caller is
# a `set -e` script. Which of the two failed is in the guard's own output —
# `lib-annotate.sh` is what writes it, and the guards keep their logs for
# exactly this.
#
# `NEGATIVE=1` selects the control, and what the control IS belongs to the
# guard rather than to this: each of them argues its own case in its own header,
# because they are not the same kind of control. Some run with no client at all,
# some with the client drawing another color, some with an `<iframe>` where the
# element under test would be.
engine_guard_and_control() { # guard script name, args...
  engine_guard "$@" || return
  wants_control || return 0
  NEGATIVE=1 engine_guard "$@"
}

# WHETHER THIS CALLER WANTS THE CONTROL, and two of them do not. A control is
# another whole run of the guard, and `pinned-engine.yml` said so in prose
# before this refactor moved the decision into the check:
#
#   No negative control alongside this. `engine.yml` already runs this script
#   with `NEGATIVE=1` to show it can fail, and that property belongs to the
#   script rather than to either caller -- a second copy here would buy nothing
#   and spend the slot twice.
#
# That job runs on every pull request at ~1m51s, and `engine-release.yml`
# invokes the guard the same way once per release. Both set
# `DOMICILE_GUARD_CONTROL=0`.
#
# DEFAULT ON, and the direction is the safety: a caller that forgets to ask gets
# the control anyway. The reverse — opt in — would drop all fourteen of the
# group's controls the first time somebody forgot, and a control that silently stopped
# running is the exact failure the controls exist to prevent, one level up.
# `scripts/test-the-workflows-delegate-their-checks.sh` asserts that `engine.yml`
# never opts out, because that is the caller for which the controls ARE the
# point.
wants_control() {
  [ "${DOMICILE_GUARD_CONTROL:-1}" != "0" ]
}

# One run of a guard, positive unless `NEGATIVE` is set.
#
# No `nix develop` here, and that is deliberate: the whole `engine` group runs
# inside one `.#full`, which is how `check.sh` documents itself being run and
# what turns thirty shell startups into one. `engineRuntimeLibs` in
# flake.nix is why the shell has to be that one — Chromium's runtime libraries
# beside the GL stack, because a client cannot hand the compositor a dmabuf
# without the latter and `libdomicile_engine.so` will not load without the
# former.
engine_guard() { # guard script name, args...
  local guard="$1"; shift
  "$ENGINE_SCRIPTS/$guard" "$ENGINE_DIR" "$@"
}

# The same, under a headless wlroots compositor for the engine to be a client
# of. Anything that reads a real client's pixels needs it, because
# `--ozone-platform=headless` cannot import a dmabuf at all. The guards that
# read a page's own colors — the `<webview>` ones — do not, and pay nothing for
# it.
engine_guard_and_control_under_wayland() { # guard script name, args...
  engine_guard_under_wayland "$@" || return
  wants_control || return 0
  NEGATIVE=1 engine_guard_under_wayland "$@"
}

engine_guard_under_wayland() { # guard script name, args...
  local guard="$1"; shift
  "$ENGINE_SCRIPTS/under-wayland.sh" "$ENGINE_DIR" \
    "$ENGINE_SCRIPTS/$guard" "$ENGINE_DIR" "$@"
}
