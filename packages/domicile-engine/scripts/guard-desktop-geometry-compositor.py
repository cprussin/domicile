#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that asks whether
the ENGINE tells the compositor how big the desktop is and at what density.

It answers `hello` with a `welcome` and prints every line the browser writes,
which is all this guard needs: what it asserts is `set_desktop_size` and
`set_device_pixel_ratio` arriving from a page that never asked for either.
"""

import argparse
import json
import os
import socket
import sys


def serve(path):
    """Accept on `path`, answer with `welcome`, print every line until EOF."""
    if os.path.exists(path):
        os.unlink(path)

    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(4)
    print("listening on %s" % path, flush=True)

    while True:
        connection, _ = listener.accept()
        print("a channel connected", flush=True)
        with connection:
            welcome = {"type": "welcome", "protocol_version": 1}
            connection.sendall((json.dumps(welcome) + "\n").encode("utf-8"))
            remainder = b""
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                remainder += chunk
                while b"\n" in remainder:
                    line, remainder = remainder.split(b"\n", 1)
                    print("said: %s" % line.decode("utf-8", "replace"), flush=True)
        print("the channel went away", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="path to bind")
    try:
        serve(parser.parse_args().socket)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
