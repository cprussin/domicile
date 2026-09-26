#!/usr/bin/env bash
# Whether anything checks that the engine `main` PINS satisfies the compositor
# `main` BUILDS.
#
# #411 landed both halves of a display-protocol change — a `name` on the
# engine's C ABI display record, and a compositor that asserts the pointer is
# non-null — while `engine-release.nix` still pinned `engine-f38ef3f`, whose
# `DomicileDisplay` is 40 bytes to the new one's 48 and has no name field at
# all. The compositor read a name out of the old struct's `x` and `y`, which
# for a display at the origin are zero, and aborted inside an `extern "C"`
# callback that cannot unwind:
#
#   the engine names every display, even if it names it nothing
#   domicile: the compositor exited (signal: 6 (SIGABRT) (core dumped))
#
# CI was green on that pull request and on every commit after it, because no
# check put the two halves in one process. `nix-build.yml` builds the flake and
# never starts a desktop; `engine.yml`'s pixel guard runs the engine it just
# built out of `patches/`, never the tarball a user downloads. The gap is
# recorded in #413, and the repin that ended the incident (#415) says the fix
# is this job.
#
# WHAT THIS FILE ASSERTS IS THAT THE JOB IS STILL THE CHEAP ONE. The check it
# runs is `scripts/engine-guard-client-window.sh`, which is one of the twenty
# `check.sh engine` runs against the tree engine.yml builds, and the difference
# — the only difference that makes this affordable — is where the engine comes
# from: `nix build .#engine` is a fetch of the pinned tarball and an
# `autoPatchelfHook` over it, not a Chromium build. A job that reached for
# `/build/chromium/src` instead would be the 27-minute queue on `crux`'s one
# slot, on every pull request, and this check would cost more than it saves.
#
# AND THAT IT RUNS ON EVERYTHING. Three separate changes can break this pair
# and only one of them is a repin: the compositor's side of the ABI
# (`packages/domicile-compositor/src/engine.rs`), the header the two agree on,
# and the pin itself. A `paths:` filter narrow enough to be tempting would let
# #411 through again — it changed the compositor and the fork, and not the pin.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"
[ -d "$WORKFLOWS" ] || { echo "no $WORKFLOWS" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

# The workflow by what it does rather than by its name: the subject here is
# "something builds the pinned engine and guards it", and a rename should move
# this file's attention rather than turn it into a green no-op.
#
# Comments are skipped, because `engine.yml` and `engine-release.yml` both
# mention `nix build .#engine` in prose — they are the two jobs that explain why
# they do NOT do this — and a comment is not a step.
#
# By WHOLE-LINE comment, not by "nothing before a `#`", which is what this used
# to say. That became too strict the moment the guard moved into a script: the
# step now reads `nix develop .#full --command
# ./scripts/engine-guard-client-window.sh`, and `[^#]*` cannot cross the `#` in
# `.#full`, so the one workflow that does this stopped matching and the rule
# reported that nothing checked the pin at all. A green no-op in the other
# direction, and the reason the count below is asserted to be exactly one.
GUARDS=""
for workflow in "$WORKFLOWS"/*.yml; do
  code="$(grep -v '^[[:space:]]*#' "$workflow")"
  printf '%s\n' "$code" | grep -qE 'nix build[^|&;]*\.#engine' || continue
  printf '%s\n' "$code" | grep -qE 'engine-guard-client-window\.sh' || continue
  GUARDS="$GUARDS $(basename "$workflow")"
done

# shellcheck disable=SC2086 # one name per word is the point
set -- $GUARDS
if [ $# -ne 1 ]; then
  fail "exactly one workflow runs the pixel guard against the pinned engine" \
    "found $#:${GUARDS:- none}. Nothing below asserted anything."
  echo "$FAILED failed"
  exit 1
fi
NAME="$1"
WORKFLOW="$WORKFLOWS/$NAME"
ok "$NAME runs the pixel guard against the pinned engine"

# --- it is the cheap one ----------------------------------------------------

# `nix build .#engine` is `fetchurl` of the url and hash in
# `engine-release.nix` and `autoPatchelfHook` over what comes out. It is the
# only way to get the bytes a user gets; a checkout build is a different
# binary, however carefully configured.
if grep -qE 'nix build[^|&;]*\.#engine' "$WORKFLOW"; then
  ok "it fetches the pinned engine rather than building one"
else
  fail "it fetches the pinned engine rather than building one" \
    "no 'nix build ... .#engine' in $NAME"
fi

# THE ASSERTION THIS FILE EXISTS FOR, and the one a plausible wrong version of
# this job fails: the guard has to be pointed at what that build wrote. A job
# that fetched the tarball and then ran the guard against `out/Domicile` would
# satisfy every other rule here and prove nothing at all. Read as "the shell
# variable the `.#engine` build was captured into is the argument the guard
# gets", so it holds whatever the variable is called.
engine_var="$(grep -oE '[A-Za-z_][A-Za-z0-9_]*="\$\(nix build[^)]*\.#engine[^)]*\)"' \
                "$WORKFLOW" | head -1 | sed 's/=.*//')"
if [ -z "$engine_var" ]; then
  fail "the guard is pointed at the engine that build produced" \
    "no shell variable in $NAME is assigned the output path of 'nix build .#engine'"
elif grep -q "DOMICILE_CHROMIUM=\"\$$engine_var\"" "$WORKFLOW"; then
  ok "the guard is pointed at the engine that build produced"
else
  fail "the guard is pointed at the engine that build produced" \
    "\$$engine_var holds the store path, and DOMICILE_CHROMIUM is not set to it — see scripts/lib/engine-guard.sh for the two variables that decide which build a check reads"
fi

# The store path is a Chromium `out` directory with nothing above it, so the
# guard has to be told that its OUT is the directory itself. Unset, it looks
# for `out/Domicile/chrome` under the store path and reports a missing engine —
# which is a red job for the wrong reason, on the slot.
if grep -qE 'DOMICILE_ENGINE_OUT=\.( |$)' "$WORKFLOW"; then
  ok "the guard is told the store path is the out directory"
else
  fail "the guard is told the store path is the out directory" \
    "no 'DOMICILE_ENGINE_OUT=.' in $NAME, so the guard looks for out/Domicile inside the store path"
fi

# Not a nicety: `--ozone-platform=headless` cannot import a dmabuf at all
# (HeadlessSurfaceFactory has no CreateNativePixmapFromHandle), so the guard
# runs the engine under a nested wlroots compositor built on a render node.
# See under-wayland.sh's own header and AGENTS.md's "Three things this cannot
# reach".
#
# Asked of the check rather than of the workflow, because that is where it is
# decided now: `scripts/engine-guard-client-window.sh` reaches
# `engine_guard_and_control_under_wayland`, and the wrapper is in
# `scripts/lib/engine-guard.sh`. Both halves are asserted, since a check naming
# a helper the library does not define would pass a grep for either one alone.
CHECK="$ROOT/scripts/engine-guard-client-window.sh"
LIB="$ROOT/scripts/lib/engine-guard.sh"
if grep -q 'engine_guard_and_control_under_wayland' "$CHECK" 2>/dev/null &&
   grep -q 'under-wayland\.sh' "$LIB" 2>/dev/null; then
  ok "the guard runs under a compositor that can pass a dmabuf"
else
  fail "the guard runs under a compositor that can pass a dmabuf" \
    "scripts/engine-guard-client-window.sh does not reach under-wayland.sh through scripts/lib/engine-guard.sh"
fi

# And a render node is hardware. `crux` is the only runner that has one;
# AGENTS.md says no runner reaches the dmabuf import, which is why
# `e2e-dmabuf.sh` is the one skip CI allows.
if grep -q 'self-hosted, *crux' "$WORKFLOW"; then
  ok "it asks for the machine with a render node"
else
  fail "it asks for the machine with a render node" \
    "$NAME does not run on [self-hosted, crux], so the dmabuf import cannot happen"
fi

# The other half of the pair. The pinned engine is only interesting against the
# compositor in THIS checkout — that is the whole question — so the compositor
# has to be built here rather than taken from anywhere else.
if grep -q 'cargo build -p domicile-compositor' "$WORKFLOW"; then
  ok "the compositor it runs is the one in the checkout"
else
  fail "the compositor it runs is the one in the checkout" \
    "$NAME never builds domicile-compositor, so what it guards against is not this tree"
fi

# THE COST CEILING. Every one of these is a step of engine.yml or
# engine-release.yml, and any of them here would mean this job takes the shared
# Chromium tree — the thing that makes those two hours long and the reason this
# one can run on every pull request.
for expensive in engine-reset.sh apply.sh autoninja /build/chromium \
                 engine-tree-lock.sh engine-tree-pool.sh engine-compile-slot.sh; do
  if grep -qF "$expensive" "$WORKFLOW"; then
    fail "it never reaches for the Chromium tree ($expensive)" \
      "$NAME names $expensive, so it is a Chromium build and not a download"
  else
    ok "it never reaches for the Chromium tree ($expensive)"
  fi
done

# --- it runs on everything --------------------------------------------------

# A `paths:` filter anywhere in the trigger block. #411 changed the compositor
# and the fork's header and left the pin alone; a filter keyed on
# `engine-release.nix` would have skipped exactly the change that broke main.
on_block="$(awk '/^on:/ { inside = 1; next }
                 inside && /^[^[:space:]]/ { inside = 0 }
                 inside { print }' "$WORKFLOW")"
if printf '%s\n' "$on_block" | grep -qE '^[[:space:]]*paths(-ignore)?:'; then
  fail "it runs on every change" \
    "$NAME filters by path, and the change that broke main did not touch the pin"
else
  ok "it runs on every change"
fi

for event in pull_request push; do
  if printf '%s\n' "$on_block" | grep -qE "^[[:space:]]*$event:"; then
    ok "it runs on $event"
  else
    fail "it runs on $event" \
      "$NAME has no $event trigger, so the pair is unproved on that event"
  fi
done

# --- and it is not the expensive job wearing a new name ---------------------

# The instruction this work came with, asserted rather than remembered:
# `engine.yml` is gated on `packages/domicile-engine/**`, so a guard living
# there would put a 27-minute Chromium build in front of every change to it.
# It also answers a different question — that the engine built from `patches/`
# passes — and a job cannot be both.
if grep -qE 'nix build[^|&;]*\.#engine' "$WORKFLOWS/engine.yml"; then
  fail "the fresh-build guard is still a separate question" \
    "engine.yml now builds .#engine too, so the pinned-engine check sits behind its path filter and its Chromium build"
else
  ok "the fresh-build guard is still a separate question"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
