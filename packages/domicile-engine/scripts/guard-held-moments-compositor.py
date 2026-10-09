#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that asks whether
the engine holds a moment event until something listens for it.

It answers `hello` with a `welcome`, asks for focus on `first` at once -- long
before the page listens -- and on `second` once the page has, and prints every
line the browser writes.
"""

import argparse
import json
import os
import socket
import sys
import time

# The page listens three seconds in; the first request lands well before that
# and the second well after.
SEQUENCE = [
    (0.05, {"type": "focus_requested", "app_id": "first"}),
    (5.0, {"type": "focus_requested", "app_id": "second"}),
]


def send(connection, message):
    connection.sendall((json.dumps(message) + "\n").encode("utf-8"))
    print("sent: %s" % json.dumps(message), flush=True)


def greet(connection):
    send(connection, {"type": "welcome", "protocol_version": 1})
    for delay, message in SEQUENCE:
        time.sleep(delay)
        send(connection, message)
    print("sent the sequence", flush=True)


def is_hello(line):
    """Whether `line` is the browser's `hello`.

    The real compositor says nothing before it. The browser drops page-bound
    lines that arrive before the page binds its end of the channel.
    """
    return json.loads(line).get("type") == "hello"


def serve(path):
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
            remainder = b""
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                remainder += chunk
                while b"\n" in remainder:
                    line, remainder = remainder.split(b"\n", 1)
                    print("said: %s" % line.decode("utf-8", "replace"), flush=True)
                    if is_hello(line):
                        greet(connection)
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
