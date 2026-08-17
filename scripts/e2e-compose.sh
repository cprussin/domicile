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

echo "== composing into an offscreen buffer =="
if cargo test -p domicile-compositor -- --ignored compose::pixels; then
  echo "PASS: portals land where the scene places them, in the order it stacks them"
else
  echo "FAIL: the composited pixels are not where the scene put them."
  echo "  The geometry is tested separately in domicile-scene; a failure here"
  echo "  with those passing means the renderer's conventions, not the maths:"
  echo "  the matrix's column order, or the output's Y direction."
  exit 1
fi
