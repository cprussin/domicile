#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that asks whether
an `<app>` routes its own input.

It answers `hello` with a `welcome`, then describes two windows: `term`, whose
surface is 400x200, and `menu`, a popup over it that grabbed the pointer. It
answers every `focus_app` with the `focus_changed` a real compositor sends, and
prints every line the browser writes -- `said: {...}` -- which is what the
guard reads: the pointer, wheel and key messages the engine sent, in the order
it sent them, in the client's surface coordinates.
"""

import argparse
import json
import os
import socket
import sys
import time

SEQUENCE = [
    {"type": "app_appeared", "app_id": "term", "title": "Term", "size": [400, 200]},
    {
        "type": "popup_placed",
        "app_id": "menu",
        "parent": "term",
        "position": [10, 20],
        "size": [50, 40],
        "grab": True,
    },
]


def send(connection, message):
    connection.sendall((json.dumps(message) + "\n").encode("utf-8"))
    print("sent: %s" % json.dumps(message), flush=True)


def answer(connection, line):
    """What a compositor says back to a line, if anything."""
    try:
        message = json.loads(line)
    except ValueError:
        return
    if message.get("type") == "focus_app":
        send(connection, {"type": "focus_changed", "app_id": message.get("app_id")})


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
            send(connection, {"type": "welcome", "protocol_version": 1})
            for message in SEQUENCE:
                time.sleep(0.05)
                send(connection, message)
            send(connection, {"type": "focus_changed", "app_id": ""})
            print("sent the sequence", flush=True)
            remainder = b""
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                remainder += chunk
                while b"\n" in remainder:
                    line, remainder = remainder.split(b"\n", 1)
                    text = line.decode("utf-8", "replace")
                    print("said: %s" % text, flush=True)
                    answer(connection, text)
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
