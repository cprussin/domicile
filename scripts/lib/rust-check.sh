# Skips a Rust check when the workspace cannot be linked on this machine.
#
# `domicile-compositor` links libxkbcommon. Without it `cargo test` fails with
#
#     rust-lld: error: unable to find library -lxkbcommon
#
# which looks like a broken tree. Skipping (exit 77) reports a missing machine
# dependency instead. `DOMICILE_CHECK_STRICT=1` makes the skip fatal in CI,
# where the library is installed.
#
# Tested by `scripts/test-a-check-that-cannot-run-says-so.sh`.

# Exit status for "could not run" (automake's convention), read by `check.sh`.
# Defined here too because this library may be sourced without `check.sh`.
readonly RUST_SKIPPED_STATUS=77

# Exits the caller with a skip unless `cc` can link `-lxkbcommon`.
#
# Links an empty program instead of searching for the file, because nix's
# library path differs from the distribution's.
#
# Exits instead of returning, like `require_nix`. In a pipeline or command
# substitution the `exit` ends only the subshell.
require_linkable_libraries() {
  command -v cc >/dev/null || {
    echo "  SKIP: no cc on PATH, so nothing in the cargo workspace can be linked"
    exit "$RUST_SKIPPED_STATUS"
  }
  printf 'int main(void) { return 0; }\n' | cc -x c - -lxkbcommon -o /dev/null 2>/dev/null || {
    echo "  SKIP: cc cannot resolve -lxkbcommon, which the compositor links; run this inside nix develop .#full, or install libxkbcommon-dev"
    exit "$RUST_SKIPPED_STATUS"
  }
}
