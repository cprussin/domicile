#!/usr/bin/env bash
# Tests that a CI job checks the engine `main` pins against the compositor
# `main` builds.
#
# Without this job, an ABI change can land with the pin still on an older
# engine. In #411 the compositor read a display `name` the pinned engine's
# 40-byte `DomicileDisplay` did not have, and aborted:
#
#   the engine names every display, even if it names it nothing
#   domicile: the compositor exited (signal: 6 (SIGABRT) (core dumped))
#
# `nix-build.yml` never starts a desktop, and `engine.yml` guards the engine it
# builds from `patches/`, not the published tarball (#413, #415).
#
# This file asserts that the job:
#
# - Stays cheap. It runs `scripts/engine-guard-client-window.sh` against
#   `nix build .#engine`, which fetches the pinned tarball and patches it. It
#   must not build Chromium on `crux`'s single slot.
# - Runs on every change. The compositor side
#   (`packages/domicile-compositor/src/engine.rs`), the shared header and the
#   pin can each break the pair, so no `paths:` filter.
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

# Finds the workflow by what it does, so a rename does not make this pass
# trivially.
#
# Whole-line comments are skipped: `engine.yml` and `engine-release.yml`
# mention `nix build .#engine` in comments. Only whole-line comments, because
# the step contains `nix develop .#full`, whose `#` is not a comment. The
# count is asserted to be one, so a pattern that matches nothing fails.
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

# `nix build .#engine` fetches the url and hash in `engine-release.nix` and
# runs `autoPatchelfHook`. Only that gives the bytes a user gets.
if grep -qE 'nix build[^|&;]*\.#engine' "$WORKFLOW"; then
  ok "it fetches the pinned engine rather than building one"
else
  fail "it fetches the pinned engine rather than building one" \
    "no 'nix build ... .#engine' in $NAME"
fi

# The guard must run against what that build wrote. A job that fetched the
# tarball and guarded `out/Domicile` would pass every other rule here. Checks
# that the variable holding the `.#engine` output is passed to the guard,
# whatever it is called.
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

# The store path is a Chromium `out` directory itself. Without
# `DOMICILE_ENGINE_OUT=.` the guard looks for `out/Domicile/chrome` under it
# and reports a missing engine.
if grep -qE 'DOMICILE_ENGINE_OUT=\.( |$)' "$WORKFLOW"; then
  ok "the guard is told the store path is the out directory"
else
  fail "the guard is told the store path is the out directory" \
    "no 'DOMICILE_ENGINE_OUT=.' in $NAME, so the guard looks for out/Domicile inside the store path"
fi

# `--ozone-platform=headless` cannot import a dmabuf
# (HeadlessSurfaceFactory has no CreateNativePixmapFromHandle), so the guard
# runs the engine under a nested wlroots compositor on a render node. See
# under-wayland.sh and AGENTS.md's "Three things this cannot reach".
#
# The check script decides this: `scripts/engine-guard-client-window.sh` calls
# `engine_guard_and_control_under_wayland`, defined in
# `scripts/lib/engine-guard.sh`. Both are checked, so a call to an undefined
# helper fails.
CHECK="$ROOT/scripts/engine-guard-client-window.sh"
LIB="$ROOT/scripts/lib/engine-guard.sh"
if grep -q 'engine_guard_and_control_under_wayland' "$CHECK" 2>/dev/null &&
   grep -q 'under-wayland\.sh' "$LIB" 2>/dev/null; then
  ok "the guard runs under a compositor that can pass a dmabuf"
else
  fail "the guard runs under a compositor that can pass a dmabuf" \
    "scripts/engine-guard-client-window.sh does not reach under-wayland.sh through scripts/lib/engine-guard.sh"
fi

# A render node needs hardware, and only `crux` has one. AGENTS.md lists the
# dmabuf import as unreachable on other runners.
if grep -q 'self-hosted, *crux' "$WORKFLOW"; then
  ok "it asks for the machine with a render node"
else
  fail "it asks for the machine with a render node" \
    "$NAME does not run on [self-hosted, crux], so the dmabuf import cannot happen"
fi

# The compositor must be built from this checkout; that is the pair under test.
if grep -q 'cargo build -p domicile-compositor' "$WORKFLOW"; then
  ok "the compositor it runs is the one in the checkout"
else
  fail "the compositor it runs is the one in the checkout" \
    "$NAME never builds domicile-compositor, so what it guards against is not this tree"
fi

# Any of these steps would make this job use the shared Chromium tree, which
# makes engine.yml and engine-release.yml take hours.
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

# No `paths:` filter in the trigger block. #411 changed the compositor and the
# fork's header but not the pin, so a filter on `engine-release.nix` would
# have skipped it.
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

# `engine.yml` is gated on `packages/domicile-engine/**` and builds Chromium,
# so this guard must not live there. It also answers a different question:
# whether the engine built from `patches/` passes.
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
