#!/usr/bin/env python3
"""Measures whether a PDF's page is still drawn after its <webview> is hidden
and shown again.

guard-pdf-after-hiding.sh shows a one-page PDF, without the viewer's toolbar
or sidebar, so the only white on screen is the page on the viewer's gray.

- Waits until the page is drawn on the viewer's gray, and counts its white
  pixels. The viewer's first frame is all white, which is not the page.
- Hides the <webview>'s box, waits for the engine to say a widget was hidden
  and then for a second with no other widget hidden, and shows it again.
- Counts the white pixels until they reach half of what they were, and keeps
  the most seen, so a page that is only slow to draw again on a busy machine
  is not called blank.

Each wait is for what it waits on, up to `--tries` half seconds.

Prints `before=<white pixels> after=<white pixels>`, `before=0` if the page
never drew, or `hidden=never` if no widget was hidden.
"""

import argparse
import base64
import pathlib
import re
import struct
import sys
import time
import zlib

from guard_webview_devtools import command, connect, shell_target

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# A pixel is the page's when every channel is at least this.
WHITE = 245
# Fewer white pixels than this is not the page yet.
DRAWN = 5000
# What WidgetBase::SetHidden logs (patch 0285) when the <webview>'s page or its
# viewer's frames are hidden. The shell's own widget is never hidden.
HIDDEN = re.compile(r"domicile: widget 0x[0-9a-f]+ hidden")
# How long no further widget may say it was hidden before the box is shown.
QUIET_S = 1.0


def is_page(white, total):
    """Whether a frame with `white` of `total` pixels white shows the page.

    The page fills a part of the window and the viewer's gray the rest, so a
    frame mostly white is the viewer's first, blank one.
    """
    return DRAWN <= white < total // 2


def white_pixels(png):
    """How many pixels of an 8-bit RGB or RGBA PNG are white, and how many
    there are."""
    if not png.startswith(PNG_SIGNATURE):
        raise SystemExit("the screenshot is not a PNG")
    offset = len(PNG_SIGNATURE)
    data = b""
    width = height = channels = None
    while offset < len(png):
        (length,) = struct.unpack("!I", png[offset : offset + 4])
        kind = png[offset + 4 : offset + 8]
        body = png[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack("!IIBB", body[:10])
            if depth != 8 or color not in (2, 6):
                raise SystemExit("the screenshot is not 8-bit RGB or RGBA")
            channels = 3 if color == 2 else 4
        elif kind == b"IDAT":
            data += body
        offset += 12 + length
    raw = zlib.decompress(data)
    stride = width * channels
    previous = bytearray(stride)
    position = 0
    white = 0
    for _ in range(height):
        kind = raw[position]
        line = bytearray(raw[position + 1 : position + 1 + stride])
        position += 1 + stride
        for i in range(stride):
            left = line[i - channels] if i >= channels else 0
            up = previous[i]
            corner = previous[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + left) & 0xFF
            elif kind == 2:
                line[i] = (line[i] + up) & 0xFF
            elif kind == 3:
                line[i] = (line[i] + (left + up) // 2) & 0xFF
            elif kind == 4:
                guess = left + up - corner
                near = min(
                    (abs(guess - left), left),
                    (abs(guess - up), up),
                    (abs(guess - corner), corner),
                    key=lambda pair: pair[0],
                )[1]
                line[i] = (line[i] + near) & 0xFF
        previous = line
        for x in range(0, stride, channels):
            if min(line[x], line[x + 1], line[x + 2]) >= WHITE:
                white += 1
    return white, width * height


class Shell:
    """The shell page, over one debugging connection."""

    def __init__(self, port):
        self.connection = connect(shell_target(port))
        self.identifier = 0

    def ask(self, method, params):
        self.identifier += 1
        answer = command(self.connection, self.identifier, method, params)
        if "result" not in answer:
            raise SystemExit("the engine refused %s: %s" % (method, answer))
        return answer["result"]

    def frame(self):
        """The white pixels in a screenshot, and all of them."""
        shot = self.ask("Page.captureScreenshot", {"format": "png"})
        return white_pixels(base64.b64decode(shot["data"]))

    def run(self, expression):
        self.ask("Runtime.evaluate", {"expression": expression})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--engine-log", required=True)
    parser.add_argument("--tries", type=int, default=60)
    args = parser.parse_args()

    shell = Shell(args.port)
    log = pathlib.Path(args.engine_log)
    try:
        before = 0
        for _ in range(args.tries):
            white, total = shell.frame()
            if is_page(white, total):
                before = white
                break
            time.sleep(0.5)
        if before == 0:
            print("before=0")
            return 0

        start = len(log.read_text(errors="replace"))
        shell.run("guardHide()")
        hidden = False
        for _ in range(args.tries):
            hidden = HIDDEN.search(log.read_text(errors="replace")[start:]) is not None
            if hidden:
                break
            time.sleep(0.5)
        if not hidden:
            print("hidden=never")
            return 0
        # The guest has more than one widget, often in more than one renderer:
        # its page's and the viewer's frame. The first to say so may not be
        # the viewer, whose hiding is what blanks the PDF, so the box stays
        # hidden until a second passes with no other widget hidden. A wait that
        # ends early only makes the run pass, never fail.
        seen = len(HIDDEN.findall(log.read_text(errors="replace")[start:]))
        quiet_since = time.monotonic()
        while time.monotonic() - quiet_since < QUIET_S:
            time.sleep(0.25)
            now = len(HIDDEN.findall(log.read_text(errors="replace")[start:]))
            if now != seen:
                seen = now
                quiet_since = time.monotonic()
        shell.run("guardShow()")

        after = 0
        for _ in range(args.tries * 2):
            after = max(after, shell.frame()[0])
            if after * 2 >= before:
                break
            time.sleep(0.25)
        print("before=%d after=%d" % (before, after))
        return 0
    finally:
        shell.connection.close()


if __name__ == "__main__":
    sys.exit(main())
