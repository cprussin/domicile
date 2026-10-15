#!/usr/bin/env python3
"""Read one pixel of the shell's window over the DevTools protocol.

Prints `GUARD pixel=rrggbb`. guard-webview-crash.sh reads the pixel at the
center of a <webview> to tell the page (green) from a view that draws nothing
(the shell's magenta) and from Chromium's sad frame (gray).

`Page.captureScreenshot` copies the shell window's composited frame, which
holds the guest's surface, so the pixel is the one the screen would show.
Coordinates are CSS pixels from the window's top left.
"""

import argparse
import base64
import struct
import sys
import zlib

from guard_webview_devtools import command, connect, shell_target

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def first_pixel(png):
    """The first pixel of a PNG as `rrggbb`.

    The first pixel of the first row decodes the same under every filter,
    since there is nothing above or to its left, so the filter is skipped.
    """
    if not png.startswith(PNG_SIGNATURE):
        raise SystemExit("the screenshot is not a PNG")
    offset = len(PNG_SIGNATURE)
    color_type = None
    data = b""
    while offset < len(png):
        (length,) = struct.unpack("!I", png[offset : offset + 4])
        kind = png[offset + 4 : offset + 8]
        body = png[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            bit_depth, color_type = body[8], body[9]
            if bit_depth != 8 or color_type not in (2, 6):
                raise SystemExit(
                    "the screenshot is depth %d, color type %d; this reads only "
                    "8-bit RGB or RGBA" % (bit_depth, color_type)
                )
        elif kind == b"IDAT":
            data += body
        offset += 12 + length
    if color_type is None:
        raise SystemExit("the screenshot has no IHDR")
    row = zlib.decompress(data)
    return "%02x%02x%02x" % (row[1], row[2], row[3])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--x", type=int, required=True)
    parser.add_argument("--y", type=int, required=True)
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answer = command(
        connection,
        1,
        "Page.captureScreenshot",
        {
            "format": "png",
            "clip": {
                "x": arguments.x,
                "y": arguments.y,
                "width": 1,
                "height": 1,
                "scale": 1,
            },
        },
    )
    if "result" not in answer:
        print("the engine refused the screenshot: %s" % answer, file=sys.stderr)
        return 1
    print("GUARD pixel=" + first_pixel(base64.b64decode(answer["result"]["data"])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
