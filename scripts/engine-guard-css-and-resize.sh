#!/usr/bin/env bash
# Checks that an <app> behaves as a replaced element under CSS and that a
# resize reaches the producer.
#
# `guard-css-and-resize.sh` applies six CSS properties to an <app> and to an
# identical <div> beside it, repeats them under a `backdrop-filter`, then
# resizes on a separate page (a resize changes the LocalSurfaceId every element
# in the document shares).
#
# Runs in Chromium's toolchain shell, not `.#full`: a component build links
# against that shell's glibc (see `spike.sh`).
#
# Headless and software-composited, so no GPU is needed. Software raster can
# differ on edge pixels, so the verdict reads interior pixels only, and the
# filtered run uses a per-pixel filter rather than a blur. See
# docs/architecture/ENGINE-FORK-MEASUREMENTS.md#css-parity.
#
# No control run: each cell is compared with the <div> in the same document.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/engine-guard.sh"
require_engine_out

# `nix-shell` has exited 0 after a failing guard, so success is a file the
# guard's last line creates.
RAN=/tmp/domicile-css-and-resize-ran
LOG=/tmp/domicile-css-and-resize-shell.log
rm -f "$RAN"

# `nix-shell` reads `NIX_PATH` rather than the flake, and the runner has none.
nixpkgs="$(nix eval --raw --impure --expr '(builtins.getFlake "nixpkgs").outPath')"
export NIX_PATH="nixpkgs=$nixpkgs"

RUN=/tmp/domicile-css-and-resize-run
cat > "$RUN" <<INNER
#!/usr/bin/env bash
set -euo pipefail
"$ENGINE_SCRIPTS/guard-css-and-resize.sh" "$ENGINE_DIR"
touch "$RAN"
INNER
chmod +x "$RUN"

# Unsets the loader variables `.#full` exports. Chromium's shell is a
# buildFHSEnv with its own glibc, and nixpkgs libraries on `LD_LIBRARY_PATH`
# stop chrome from starting:
#
#   out/Domicile/chrome: /lib/libc.so.6: version `GLIBC_ABI_GNU2_TLS' not found
#     (required by /nix/store/...-systemd-261.2/lib/libudev.so.1)
#
# Only these two: nothing in this shell compiles, so the other variables are
# harmless. `scripts/test-chromiums-shell-is-entered-clean.sh` asserts this.
if env -u LD_LIBRARY_PATH -u LD_PRELOAD \
     NIX_SHELL_RUN="$RUN" nix-shell "$ENGINE_DIR/tools/nix/shell.nix" \
     >"$LOG" 2>&1; then
  echo "the shell exited 0"
else
  echo "the shell exited $?"
fi

# Enough lines to keep the result tables: the guard prints three long runs.
tail -300 "$LOG" | sed 's/^/  | /'

[ -e "$RAN" ] || {
  # Quotes the guard's own failure line rather than guessing which run failed:
  # the guard knows. `|| :` because a grep with no match exits 1 under
  # `set -e`, which would skip the fallback.
  said="$( { grep -a '^step 4 failed:' "$LOG" || :; } | tail -1)"
  if [ -n "$said" ]; then
    annotate "$said"
  else
    annotate "the css-and-resize guard never reached its own verdict — the" \
      "producer did not finish, or the shell around it did not start. Its" \
      "last words are above, and the whole log is in $LOG"
  fi
  exit 1
}

# Prints the guard's `PASS:` lines unquoted, from the whole log, because
# `check.sh` shows only those for a passing check. Fails under `set -e` if the
# guard stated none.
grep -a '^PASS: ' "$LOG"
