#!/usr/bin/env python3
"""Print the color the engine's window shows at one point, as `#rrggbb`.

Takes a one-pixel `Page.captureScreenshot` of the shell's page. The capture is
a copy of the window's composited frame, so it includes the browser window's
guest surface as viz drew it, and a guest left on an old frame reads as that
frame's color.

Coordinates are CSS pixels from the shell window's top left.
"""

import argparse
import base64
import struct
import zlib

from guard_webview_devtools import command, connect, shell_target

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def pixel(png):
    """The color of a one-pixel PNG, as `#rrggbb`.

    Every PNG row filter predicts from neighbors that are zero for the first
    pixel of the first row, so the filtered bytes are the pixel's own.
    """
    if not png.startswith(PNG_SIGNATURE):
        raise SystemExit("the capture is not a PNG")
    offset = len(PNG_SIGNATURE)
    header = None
    data = b""
    while offset < len(png):
        (length,) = struct.unpack("!I", png[offset : offset + 4])
        kind = png[offset + 4 : offset + 8]
        body = png[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            header = struct.unpack("!IIBBBBB", body)
        elif kind == b"IDAT":
            data += body
        offset += 12 + length
    if header is None:
        raise SystemExit("the capture has no IHDR chunk")
    width, height, depth, color_type = header[:4]
    # 2 is RGB, 6 is RGBA; both start a pixel with its red, green and blue.
    if (width, height, depth) != (1, 1, 8) or color_type not in (2, 6):
        raise SystemExit("the capture is not one 8-bit RGB pixel: %s" % (header,))
    row = zlib.decompress(data)
    return "#%02x%02x%02x" % (row[1], row[2], row[3])


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
        raise SystemExit("the engine refused the capture: %s" % answer)
    print(pixel(base64.b64decode(answer["result"]["data"])))


if __name__ == "__main__":
    main()
