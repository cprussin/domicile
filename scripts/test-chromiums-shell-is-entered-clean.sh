#!/usr/bin/env bash
# That the one check which enters Chromium's own shell does not carry
# domicile's library path into it.
#
# TWO SHELLS, AND THE SECOND ONE IS ENTERED FROM INSIDE THE FIRST. The whole
# `engine` group runs in one `nix develop .#full`, which is what turns thirty
# shell startups into one. `scripts/engine-guard-css-and-resize.sh` then enters
# Chromium's own toolchain shell, because a component build links against that
# shell's glibc and `spike.sh` says so.
#
# `.#full` EXPORTS `LD_LIBRARY_PATH`, and that is the collision. flake.nix sets
# it to `/run/opengl-driver/lib` plus the GL stack plus `engineRuntimeLibs`,
# because the compositor `dlopen`s libEGL and `mkShell` only wires build-time
# linkage. Chromium's shell is a buildFHSEnv whose `/lib/libc.so.6` is the FHS
# glibc, so a nixpkgs library inherited through the loader path is one built
# against a glibc that is not the one resolving it:
#
#   out/Domicile/chrome: /lib/libc.so.6: version `GLIBC_ABI_GNU2_TLS' not found
#     (required by /nix/store/...-systemd-261.2/lib/libudev.so.1)
#   out/Domicile/chrome: /lib/libc.so.6: version `GLIBC_2.42' not found
#     (required by /nix/store/...-ncurses-6.6/lib/libncursesw.so.6)
#
# chrome never started, `spike.sh` reported `the page never asked to embed`
# after its sixty looks, and the guard's own verdict was the catch-all — "the
# CSS half, neither a cell nor the probe". Engine run 35678987261 attempt 2, on
# the fourteen checks before it passing.
#
# WHAT THIS ASSERTS IS THE FIX RATHER THAN THE SYMPTOM, because the symptom
# needs a Chromium build and this runs anywhere. The check has to hand
# Chromium's shell an environment with no loader path of domicile's in it —
# which is exactly the environment `engine.yml` used to hand it, back when that
# shell was entered from a workflow step rather than from inside `.#full`.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/scripts/engine-guard-css-and-resize.sh"
[ -f "$CHECK" ] || { echo "no $CHECK" >&2; exit 1; }

FAILED=0
ok() { printf '  ok    %s\n' "$1"; }
fail() {
  printf '  FAIL  %s\n    %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A tree with an out directory in it, which is all `require_engine_out` looks
# for: this test is about the environment the check builds, not about a build.
TREE="$WORK/chromium/src"
mkdir -p "$TREE/out/Domicile" "$TREE/tools/nix"
: >"$TREE/tools/nix/shell.nix"

# Stand-ins for the two nix commands the check runs, on PATH ahead of anything
# real. `nix-shell` writes down the environment it was handed and then fails,
# because what it would have run needs a Chromium build; the check's sentinel
# is what turns that into a loud failure, which is the behavior under test in
# `scripts/test-a-check-that-cannot-run-says-so.sh` rather than here.
BIN="$WORK/bin"
mkdir -p "$BIN"
RECORD="$WORK/handed-to-chromiums-shell"

cat >"$BIN/nix" <<'STUB'
#!/usr/bin/env bash
# Only `nix eval` is asked for, and only for the nixpkgs path.
echo /nix/store/00000000000000000000000000000000-nixpkgs
STUB

cat >"$BIN/nix-shell" <<STUB
#!/usr/bin/env bash
env >"$RECORD"
printf 'shell.nix was %s\n' "\$1" >>"$RECORD"
exit 1
STUB

chmod +x "$BIN/nix" "$BIN/nix-shell"

# The loader path `.#full` would have exported, in the shape flake.nix builds:
# the driver directory first, then nixpkgs copies.
OUTER_LIBS="/run/opengl-driver/lib:/nix/store/1111-libGL/lib:/nix/store/2222-systemd/lib"

PATH="$BIN:$PATH" \
  DOMICILE_CHROMIUM="$TREE" \
  LD_LIBRARY_PATH="$OUTER_LIBS" \
  LD_PRELOAD=/nix/store/3333-something/lib/libsomething.so \
  "$CHECK" >"$WORK/out" 2>&1
status=$?

# THE POSITIVE FIRST. A test whose stand-in was never reached passes every
# assertion below it while establishing nothing, and this file's whole subject
# is one invocation's environment.
if [ -f "$RECORD" ] && grep -q "^shell.nix was $TREE/tools/nix/shell.nix$" "$RECORD"; then
  ok "the check entered Chromium's shell for this tree"
else
  fail "the check entered Chromium's shell for this tree" \
    "no record at $RECORD naming $TREE/tools/nix/shell.nix, so nothing below was asserted; the check said: $(tail -3 "$WORK/out" | tr '\n' ' ')"
  echo "$FAILED failed"
  exit 1
fi

# The two the loader reads. Everything else `.#full` sets is about compiling,
# and nothing inside that shell compiles: `spike.sh` runs `out/Domicile/chrome`
# and the producer beside it, both already linked.
for var in LD_LIBRARY_PATH LD_PRELOAD; do
  if grep -q "^$var=" "$RECORD"; then
    fail "Chromium's shell is handed no $var" \
      "it was handed $(grep "^$var=" "$RECORD" | head -1) — a nixpkgs library resolved against the FHS glibc, which is how chrome failed to start at all"
  else
    ok "Chromium's shell is handed no $var"
  fi
done

# And the check still fails loudly, because the stand-in shell ran nothing: the
# sentinel is the only evidence this check trusts, and a shell that exits over
# a guard that never ran has done it before.
if [ "$status" -ne 0 ]; then
  ok "a shell that ran nothing is still a failure ($status)"
else
  fail "a shell that ran nothing is still a failure" \
    "the check exited 0 having taken no measurement, which is the failure this repository has shipped three times"
fi

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED failed"
  exit 1
fi
echo "all ok"
