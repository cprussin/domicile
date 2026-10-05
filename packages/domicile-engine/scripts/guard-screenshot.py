#!/usr/bin/env python3
"""Asks an engine for a screenshot until its center is one color.

Sends `screenshot` on the engine's command socket, reads the PNG it wrote,
and compares the center pixel. Retries until --for-seconds, since the shell
may not have painted yet.

Exit status:
  0  the center is --want
  1  a screenshot was written and its center is another color
  2  no screenshot was written; the engine's last reply is printed
"""

import argparse
import json
import socket
import struct
import sys
import time
import zlib


def ask(path, file, patience):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(patience)
        connection.connect(path)
        line = {"type": "screenshot", "version": 1, "file": file}
        connection.sendall((json.dumps(line) + "\n").encode())
        reply = b""
        while not reply.endswith(b"\n"):
            got = connection.recv(4096)
            if not got:
                break
            reply += got
    return json.loads(reply)


def center(file):
    """The center pixel of an 8-bit RGB or RGBA PNG, as RRGGBB."""
    with open(file, "rb") as reading:
        data = reading.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{file} is not a PNG")
    offset, idat = 8, b""
    while offset < len(data):
        (length,) = struct.unpack(">I", data[offset : offset + 4])
        kind = data[offset + 4 : offset + 8]
        body = data[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color_type = struct.unpack(">IIBB", body[:10])
        elif kind == b"IDAT":
            idat += body
        offset += 12 + length
    if depth != 8 or color_type not in (2, 6):
        raise ValueError(f"{file} is depth {depth}, color type {color_type}")
    channels = 3 if color_type == 2 else 4
    stride = width * channels
    raw = zlib.decompress(idat)
    previous = bytearray(stride)
    for y in range(height // 2 + 1):
        start = y * (stride + 1)
        kind, row = raw[start], bytearray(raw[start + 1 : start + 1 + stride])
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            up = previous[x]
            corner = previous[x - channels] if x >= channels else 0
            if kind == 1:
                row[x] = (row[x] + left) & 0xFF
            elif kind == 2:
                row[x] = (row[x] + up) & 0xFF
            elif kind == 3:
                row[x] = (row[x] + (left + up) // 2) & 0xFF
            elif kind == 4:
                guess = left + up - corner
                near = min(
                    (abs(guess - left), 0, left),
                    (abs(guess - up), 1, up),
                    (abs(guess - corner), 2, corner),
                )[2]
                row[x] = (row[x] + near) & 0xFF
        previous = row
    x = (width // 2) * channels
    return previous[x : x + 3].hex().upper()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--want", required=True)
    parser.add_argument("--for-seconds", type=float, default=60)
    arguments = parser.parse_args()

    until = time.monotonic() + arguments.for_seconds
    said, seen = None, None
    while time.monotonic() < until:
        # A hang-up without a reply, or a file that is not an 8-bit PNG, is
        # no screenshot rather than one of the wrong color.
        try:
            said = ask(arguments.socket, arguments.file, until - time.monotonic())
            if isinstance(said, dict) and said.get("type") == "captured":
                seen = center(arguments.file)
                print(f"the screenshot's center is {seen}")
                if seen == arguments.want.upper():
                    return 0
        except (OSError, ValueError) as why:
            said = f"no screenshot: {why}"
        time.sleep(0.5)
    if seen is None:
        print(f"no screenshot was written; the engine last said {said}")
        return 2
    return 1


if __name__ == "__main__":
    sys.exit(main())
