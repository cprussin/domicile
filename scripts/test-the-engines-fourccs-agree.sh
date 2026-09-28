#!/usr/bin/env bash
# Whether the compositor advertises exactly the pixel formats the engine
# imports.
#
# Two lists, in two languages: `FormatFromFourcc` in the fork's
# brokered_frame_sink.cc, which refuses any other fourcc, and `FOURCCS` in the
# compositor's engine.rs, which is all `zwp_linux_dmabuf_v1` offers a client.
# A format in the first and not the second is one no client is offered; one in
# the second and not the first is a window whose every frame is refused. That
# is how imv drew nothing: it chose XR30, the renderer advertised it, and the
# engine had no SharedImageFormat for it.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/packages/domicile-engine/src/components/domicile/browser/brokered_frame_sink.cc"
COMPOSITOR="$ROOT/packages/domicile-compositor/src/engine.rs"

for file in "$ENGINE" "$COMPOSITOR"; do
  if [ ! -f "$file" ]; then
    echo "FAIL: no $file — one of the two lists has moved" >&2
    exit 1
  fi
done

# The case labels of FormatFromFourcc, and the entries of FOURCCS.
engine=$(sed -n '/FormatFromFourcc(uint32_t fourcc)/,/^}/p' "$ENGINE" |
  grep -o 'case 0x[0-9a-fA-F]*' | sed 's/case 0x//' | tr 'A-F' 'a-f' | sort)
compositor=$(sed -n '/pub const FOURCCS/,/\];/p' "$COMPOSITOR" |
  grep -o '0x[0-9a-fA-F_]*' | sed 's/0x//; s/_//g' | tr 'A-F' 'a-f' | sort)

# Empty is a parse that found nothing, which would agree with itself.
if [ -z "$engine" ] || [ -z "$compositor" ]; then
  echo "FAIL: read no fourccs (engine: '$engine', compositor: '$compositor')" >&2
  exit 1
fi

if [ "$engine" != "$compositor" ]; then
  echo "FAIL: the engine imports and the compositor advertises different fourccs" >&2
  diff <(echo "$engine") <(echo "$compositor") | sed 's/^/  /' >&2
  exit 1
fi
echo "ok: the compositor advertises the $(echo "$engine" | wc -l) fourccs the engine imports"
