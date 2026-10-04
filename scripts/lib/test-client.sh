# Builds the workspace's own Wayland test client for the e2e checks. It needs
# no weston, libwayland or GPU, so the checks never have to skip for lack of a
# client.

# Builds the client and sets `TEST_CLIENT`. A build failure is a broken tree,
# so it fails instead of skipping.
#
# The binary target lives in `domicile-compositor` so cargo builds it with
# that package's integration tests, which spawn it.
build_test_client() {
  TEST_CLIENT="$ROOT/target/debug/domicile-test-client"
  cargo build -p domicile-compositor --bin domicile-test-client >/dev/null 2>&1 || {
    echo "the test client did not build; run: cargo build -p domicile-compositor --bin domicile-test-client"
    return 1
  }
  [ -x "$TEST_CLIENT" ] || {
    echo "no test client at $TEST_CLIENT after building"
    return 1
  }
  export TEST_CLIENT
}
