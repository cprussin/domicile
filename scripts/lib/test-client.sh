# The stand-in Wayland client these checks open a window with.
#
# Fourteen of them used to reach for weston's demos — `weston-flower`,
# `weston-terminal`, `weston-simple-shm` — and what they did on a machine
# without them was `exit 77`. A check that stopped running is the worst outcome
# a check can have and the one nobody notices, so the client is ours now: it
# speaks the protocol from the workspace's own crates, and needs no weston, no
# libwayland and no GPU.
#
# Sourced rather than copied for the reason `harness.sh` gives: five scripts
# with five copies of a build step is five places for one of them to drift.

# Build it and set `TEST_CLIENT` to the binary.
#
# Fails the caller rather than skipping it. A missing weston was a fact about
# the machine, which is what `exit 77` is for; a client that will not build is
# a broken tree, and a check that shrugged at that would be hiding the thing it
# is here to find.
#
# `-p domicile-compositor` because that is the package the binary belongs to —
# its integration tests spawn one, and cargo builds a package's binaries with
# its tests, which is the only stable way to have them arrive together. The
# code is `domicile-test-client`'s all the same; only the target lives there.
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
