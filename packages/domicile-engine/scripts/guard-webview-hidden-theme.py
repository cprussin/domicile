#!/usr/bin/env python3
"""Measures which theme a hidden page's first frame is in when it is shown.

guard-webview-hidden-theme.sh shows a page that is yellow in a light color
scheme and blue in a dark one.

- Waits until the page is drawn yellow.
- Hides the <webview>'s box, turns the desk dark by creating `--turn` (the
  claim) or leaves the page to turn itself (the control), waits `--hidden`
  seconds, and shows the box again.
- Reads the page's center pixel in the first screenshot after the show, then
  for `--after` seconds until it is blue.

Prints `first=<scheme> settled=<scheme>`, each `light`, `dark` or
`other(<r>,<g>,<b>)`, or `first=never` if the page never drew.
"""

import argparse
import base64
import pathlib
import struct
import sys
import time
import zlib

from guard_webview_devtools import command, connect, shell_target

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def theme_of(png):
    """`light`, `dark` or `other(...)`, for a one-pixel 8-bit RGB or RGBA PNG."""
    if not png.startswith(PNG_SIGNATURE):
        raise SystemExit("the screenshot is not a PNG")
    offset = len(PNG_SIGNATURE)
    data = b""
    while offset < len(png):
        (length,) = struct.unpack("!I", png[offset : offset + 4])
        kind = png[offset + 4 : offset + 8]
        body = png[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack("!IIBB", body[:10])
            if (width, height, depth) != (1, 1, 8) or color not in (2, 6):
                raise SystemExit("the screenshot is not one 8-bit RGB or RGBA pixel")
        elif kind == b"IDAT":
            data += body
        offset += 12 + length
    # One pixel has no neighbors, so every PNG row filter leaves it as stored.
    red, green, blue = zlib.decompress(data)[1:4]
    if (red, green, blue) == (255, 255, 0):
        return "light"
    elif (red, green, blue) == (0, 0, 255):
        return "dark"
    else:
        return "other(%d,%d,%d)" % (red, green, blue)


class Shell:
    """The shell page, over one debugging connection."""

    def __init__(self, port):
        self.connection = connect(shell_target(port))
        self.identifier = 0
        self.center = None

    def ask(self, method, params):
        self.identifier += 1
        answer = command(self.connection, self.identifier, method, params)
        if "result" not in answer:
            raise SystemExit("the engine refused %s: %s" % (method, answer))
        return answer["result"]

    def theme(self):
        if self.center is None:
            size = self.ask("Runtime.evaluate", {
                "expression": "[innerWidth, innerHeight]",
                "returnByValue": True,
            })["result"]["value"]
            self.center = (size[0] // 2, size[1] // 2)
        x, y = self.center
        shot = self.ask("Page.captureScreenshot", {
            "format": "png",
            "clip": {"x": x, "y": y, "width": 1, "height": 1, "scale": 1},
        })
        return theme_of(base64.b64decode(shot["data"]))

    def run(self, expression):
        self.ask("Runtime.evaluate", {"expression": expression})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--turn", required=True)
    parser.add_argument("--mode", choices=("claim", "control"), required=True)
    parser.add_argument("--tries", type=int, default=60)
    parser.add_argument("--hidden", type=float, default=5.0)
    parser.add_argument("--after", type=float, default=5.0)
    args = parser.parse_args()

    shell = Shell(args.port)
    try:
        drawn = False
        for _ in range(args.tries):
            drawn = shell.theme() == "light"
            if drawn:
                break
            time.sleep(0.5)
        if not drawn:
            print("first=never")
            return 0

        shell.run("guardHide()")
        time.sleep(0.5)
        if args.mode == "claim":
            pathlib.Path(args.turn).touch()
        time.sleep(args.hidden)
        shell.run("guardShow()")
        first = shell.theme()

        settled = first
        until = time.monotonic() + args.after
        while settled != "dark" and time.monotonic() < until:
            time.sleep(0.1)
            settled = shell.theme()
        print("first=%s settled=%s" % (first, settled))
        return 0
    finally:
        shell.connection.close()


if __name__ == "__main__":
    sys.exit(main())
