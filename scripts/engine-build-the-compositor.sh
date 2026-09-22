#!/usr/bin/env bash
# The guards' producer, built before any of them looks for it.
#
# Every guard in this group drives a real compositor: `under-wayland.sh` starts
# one as a client of the nested wlroots session, and the `<webview>` guards
# start one to speak the host protocol at the page. All of them only CHECK for
# the binary — none builds it — so something has to, and on `crux` that is not
# optional in the way it sounds. The runner unit's ExecStartPre deletes its
# whole work directory on every start, so the first job after any restart or
# deploy finds no `target/` at all.
#
# WHICH IS EXACTLY WHAT WENT WRONG when the guards moved out of `engine.yml`.
# That workflow had a `Build the compositor` step sitting between the unit tests
# and the first guard; folding thirty steps into one `check.sh engine` left it
# behind, and run 35552949501 got three checks in before
# `engine-guard-client-window` stopped on `no compositor at
# .../target/debug/domicile-compositor`.
#
# A CHECK RATHER THAN A WORKFLOW STEP, and that is the point of the group. A
# person on `crux` with a warm tree runs `check.sh engine` and needs the
# producer as much as CI does; putting it back in the YAML would have fixed the
# job and left the command broken. `check.sh`'s own header says it owns the
# environment as well as the running -- it installs what is missing and finds
# what is not on `PATH` -- and `scripts/lib/test-client.sh` already builds this
# same package for the e2e scripts on the same reasoning.
#
# `-p domicile-compositor` because that is the package the binary belongs to,
# and cargo builds a package's binaries with its tests -- which is also how
# `domicile-test-client` arrives, since its target lives there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"

# The tree is required here as much as anywhere in the group, so that a machine
# without one reports eighteen skips rather than seventeen skips and a cargo
# build. It is the same reason every other check in the group asks first.
require_engine_out

cd "$ROOT"
cargo build -p domicile-compositor
