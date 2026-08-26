#!/usr/bin/env bash
# Compose the scene into a buffer and check the pixels landed where the scene
# said they would.
#
#   nix develop .#full -c ./scripts/e2e-compose.sh
#
# These are `cargo test`s rather than a shell harness — they drive the renderer
# directly — but they are `#[ignore]`d, because CI's compositor job installs
# only libxkbcommon and they would fail there for want of a GL stack rather
# than for anything about the code. This is where a machine that *has* a
# renderer runs them.
#
# No GPU and no display needed: EGL hands over a software rasteriser where
# there is no hardware, and the output is an offscreen buffer read back rather
# than a window. Presentation is the part this cannot cover.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Run a filtered set of `#[ignore]`d tests and insist that it ran some.
#
# The filter is a substring, and cargo does not think a filter matching nothing
# is an error: it is `test result: ok. 0 passed; ... 146 filtered out`, exit 0.
# So renaming a module — an ordinary refactor — silently stops running every
# test under it, and this script prints PASS. That is the exact false green
# `check.sh` exists to prevent, in the largest suite it gates, and no harness
# above can see it because the exit code is 0.
#
# `least` is what the filter is known to match. It does not have to track the
# count as tests are added; it has to be high enough that a filter which
# stopped matching cannot slip under it.
run_filtered() {
  local filter="$1" least="$2" log ran ran_ok
  log="$(mktemp)"
  # `PIPESTATUS` rather than the pipeline's own status, which is `tee`'s — and
  # `tee` succeeds whenever it can write the file. Without this a failing
  # `cargo test` fell through to the count below, where a binary that printed
  # `test result: FAILED` contributed nothing to the sum and tripped the floor
  # instead: the right verdict reached by the wrong route, reported as a
  # renamed module when what was actually wrong was the pixels.
  cargo test -p domicile-compositor -- --ignored "$filter" 2>&1 | tee "$log"
  ran_ok="${PIPESTATUS[0]}"
  if [ "$ran_ok" -ne 0 ]; then
    rm -f "$log"; return 1
  fi
  # Summed across every test binary rather than taken from the last one.
  # `cargo test -p` runs the crate's unit tests *and* everything in `tests/`,
  # and an integration binary the filter does not name reports `ok. 0 passed`
  # after them — so `tail -1` read the count as zero the moment this crate
  # grew its first `tests/` file, and this guard fired about a rename that had
  # not happened.
  #
  # The sum takes any `--ignored` test from any binary in the crate, so the
  # floor assumes the ignored set lives in the unit tests. It does today: the
  # `tests/` files ignore nothing. The first `#[ignore]`d test added to one
  # whose name contains a filter substring inflates `ran` and lifts this floor
  # off the thing it guards, so raise it deliberately then.
  #
  # `awk` prints on every input, empty included, so `$ran` is always a number.
  ran="$(sed -n 's/^test result: ok\. \([0-9]*\) passed.*/\1/p' "$log" |
    awk '{ total += $1 } END { print total + 0 }')"
  rm -f "$log"
  if [ "$ran" -lt "$least" ]; then
    echo
    echo "FAIL: '$filter' matched $ran tests, and this suite has at least $least."
    echo "  cargo treats a filter that matches nothing as a pass, so a renamed"
    echo "  module stops running every test under it and still exits 0. Either"
    echo "  the filter no longer names the module, or tests were removed and"
    echo "  this floor needs lowering deliberately."
    return 1
  fi
  return 0
}

echo "== composing into an offscreen buffer =="
if run_filtered compose::pixels 20; then
  echo "PASS: portals land where the scene places them, in the order it stacks them"
else
  echo "FAIL: the composited pixels are not where the scene put them."
  echo "  The geometry is tested separately in domicile-scene; a failure here"
  echo "  with those passing means the renderer's conventions, not the maths:"
  echo "  the matrix's column order, or the output's Y direction."
  exit 1
fi

echo
echo "== reading an area back off the GPU =="
if run_filtered dmabuf_import::readback 2; then
  echo "PASS: a readback gives the rows it was asked for, packed tight"
else
  echo "FAIL: the readback is not the pixels the region names."
  echo "  The region arithmetic is tested without a renderer; a failure here"
  echo "  with those passing means the copy out of the framebuffer: the"
  echo "  rectangle's origin, or the stride the mapping is packed at."
  exit 1
fi
