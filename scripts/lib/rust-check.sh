# Whether anything in the cargo workspace can be linked here.
#
# `cargo test` is the only step in `check.sh`'s `rust` group that produces a
# binary, and `domicile-compositor` is the one crate that links a system
# library: libxkbcommon, which is why `cargo-test.yml` installs
# `libxkbcommon-dev` before it runs anything. On a machine without it the run
# reaches `cargo test` having passed `cargo fmt` and `cargo clippy` — neither
# of which links — and ends in
#
#     rust-lld: error: unable to find library -lxkbcommon
#
# under two hundred lines of object file names. That is a fact about the
# machine wearing the costume of a broken tree, and it arrives last, which is
# where a reader is least able to tell the two apart. It cost a session a
# baseline run to work out that nothing was wrong with the code.
#
# So this says it instead, and `check.sh` reads exit 77 as a check that did not
# run rather than one that passed. Under `DOMICILE_CHECK_STRICT=1` the skip is
# fatal, which is what keeps it honest in CI: the libraries are installed
# there, so a skip in that job is a step that stopped running.
#
# Sourced rather than copied, and driven directly by
# `scripts/test-a-check-that-cannot-run-says-so.sh`, for the reasons
# `lib/nix-check.sh` gives.

# The status a check exits with to say it could not run — automake's
# convention, and what `check.sh` reads. Spelled here as well as there because
# a library cannot depend on having been sourced by that one script.
readonly RUST_SKIPPED_STATUS=77

# A linkable libxkbcommon, or a skip that says so and ends the check.
#
# THE COMPILER IS ASKED RATHER THAN THE FILESYSTEM SEARCHED. Whether
# `-lxkbcommon` resolves is a question about `cc`'s own search path, and nix's
# is not the distribution's: looking for the file under
# `/usr/lib/x86_64-linux-gnu` would report it missing inside
# `nix develop .#full`, where it is present and nowhere near there. Linking an
# empty program is the same question the build asks, put the same way.
#
# Ends the caller rather than returning, as `require_nix` does and for the same
# reason — and under the same condition: in a pipeline or a command
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
