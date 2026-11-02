# Skips a check that needs nix when nix is missing.
#
# The repo does not install nix, so `test:nix` skips
# instead of failing without it. `DOMICILE_CHECK_STRICT=1` makes the skip
# fatal in CI.
#
# Tested by `tests/test-a-nix-check-without-nix-says-so.sh`.

# Exit status for "could not run" (automake's convention), read by
# `check-runner`. Defined here too because this library is sourced without it.
readonly NIX_SKIPPED_STATUS=77

# Exits the caller with a skip if nix is not on PATH. It exits instead of
# returning so callers cannot forget to check. In a pipeline or command
# substitution the `exit` ends only the subshell.
require_nix() {
  command -v nix >/dev/null || {
    echo "  SKIP: no nix on PATH, so nothing can be built from the flake"
    exit "$NIX_SKIPPED_STATUS"
  }
}
