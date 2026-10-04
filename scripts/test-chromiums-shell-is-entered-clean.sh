#!/usr/bin/env bash
# Checks that `scripts/engine-guard-css-and-resize.sh` enters Chromium's
# toolchain shell without domicile's loader path.
#
# The `engine` group runs inside `nix develop .#full`, which exports
# `LD_LIBRARY_PATH` (the compositor `dlopen`s libEGL). Chromium's shell is a
# buildFHSEnv with its own glibc, so inherited nixpkgs libraries fail to load:
#
#   out/Domicile/chrome: /lib/libc.so.6: version `GLIBC_2.42' not found
#     (required by /nix/store/...-ncurses-6.6/lib/libncursesw.so.6)
#
# This asserts the environment handed to the shell, since the symptom needs a
# Chromium build.
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

# `require_engine_out` only looks for an out directory.
TREE="$WORK/chromium/src"
mkdir -p "$TREE/out/Domicile" "$TREE/tools/nix"
: >"$TREE/tools/nix/shell.nix"

# Stubs for the two nix commands the check runs. `nix-shell` records its
# environment and fails; the check's sentinel turns that into a failure, which
# `scripts/test-a-check-that-cannot-run-says-so.sh` covers.
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

# The loader path `.#full` exports: the driver directory, then nixpkgs copies.
OUTER_LIBS="/run/opengl-driver/lib:/nix/store/1111-libGL/lib:/nix/store/2222-systemd/lib"

PATH="$BIN:$PATH" \
  DOMICILE_CHROMIUM="$TREE" \
  LD_LIBRARY_PATH="$OUTER_LIBS" \
  LD_PRELOAD=/nix/store/3333-something/lib/libsomething.so \
  "$CHECK" >"$WORK/out" 2>&1
status=$?

# Without this, a stub that was never reached would pass every assertion below.
if [ -f "$RECORD" ] && grep -q "^shell.nix was $TREE/tools/nix/shell.nix$" "$RECORD"; then
  ok "the check entered Chromium's shell for this tree"
else
  fail "the check entered Chromium's shell for this tree" \
    "no record at $RECORD naming $TREE/tools/nix/shell.nix, so nothing below was asserted; the check said: $(tail -3 "$WORK/out" | tr '\n' ' ')"
  echo "$FAILED failed"
  exit 1
fi

# Only the loader variables matter: nothing in Chromium's shell compiles, and
# `spike.sh` runs prebuilt binaries.
for var in LD_LIBRARY_PATH LD_PRELOAD; do
  if grep -q "^$var=" "$RECORD"; then
    fail "Chromium's shell is handed no $var" \
      "it was handed $(grep "^$var=" "$RECORD" | head -1) — a nixpkgs library resolved against the FHS glibc, which is how chrome failed to start at all"
  else
    ok "Chromium's shell is handed no $var"
  fi
done

# The stub ran nothing, so the check must still fail: it trusts only the
# sentinel.
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
