# Whether a check that needs nix can run here.
#
# The `nix` group of `check.sh` is every assertion about what the flake
# produces — that both shells build, that the module evaluates, that an
# installed `domicile` can find the rest of itself. All of it needs `nix`, and
# `nix` is the one tool this repository does not pin for you: it is what does
# the pinning.
#
# So these checks have to skip rather than fail on a machine without it. That
# is not politeness, it is the difference between `./scripts/check.sh` being
# runnable on a laptop and being a command that always ends red — and a suite
# nobody can run is a suite nobody runs. Under `DOMICILE_CHECK_STRICT=1` the
# skip is fatal anyway, which is what keeps it honest in CI.
#
# Sourced rather than copied, and driven directly by
# `scripts/test-a-check-that-cannot-run-says-so.sh`: six scripts with six
# copies of one `command -v` is six places for one of them to reach for
# `exit 1`.

# The status a check exits with to say it could not run — automake's
# convention, and what `check.sh` reads. Spelled here as well as there because
# a library cannot depend on having been sourced by that one script.
readonly NIX_SKIPPED_STATUS=77

# nix, or a skip that says so and ends the check.
#
# Ends the caller rather than returning, so a script cannot reach its first
# `nix build` by forgetting to branch on a status. That is the same reason
# `lib/harness.sh`'s helpers exit, and it holds under the same condition: in a
# pipeline or a command substitution the `exit` ends only the subshell.
require_nix() {
  command -v nix >/dev/null || {
    echo "  SKIP: no nix on PATH, so nothing can be built from the flake"
    exit "$NIX_SKIPPED_STATUS"
  }
}
