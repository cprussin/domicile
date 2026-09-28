#!/usr/bin/env python3
"""The compositor's end of the control socket, for guard-extension-installer.sh.

It accepts the browser's connection, answers with a `welcome`, and sends one
`extensions` message naming the directories it was given as `unpacked` --
none, for the guard's control. That is what the real compositor sends at the
handshake from a desk's `[extensions]`, spelled as `domicile-protocol` spells
it (`wire/host-messages.jsonl`).

It says `sent the extensions` once the line is written, which is the guard's
reading of whether the list crossed at all: a run with no mark and no such
line is a channel that never connected, not an installer that did nothing.
"""

import argparse
import json
import os
import socket
import sys


def send(connection, message):
    """Write one newline-delimited JSON message and say so."""
    line = json.dumps(message) + "\n"
    connection.sendall(line.encode("utf-8"))
    print("sent: %s" % line.strip(), flush=True)


def serve(path, unpacked):
    """Accept on `path`, send the welcome and the list, then read until EOF."""
    if os.path.exists(path):
        os.unlink(path)

    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(4)
    # Before accept, so a guard waiting on this line is not waiting on a buffer.
    print("listening on %s" % path, flush=True)

    while True:
        connection, _ = listener.accept()
        print("a channel connected", flush=True)
        with connection:
            send(connection, {"type": "welcome", "protocol_version": 1})
            send(
                connection,
                {"type": "extensions", "web_store": [], "unpacked": unpacked},
            )
            print("sent the extensions", flush=True)

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
    parser.add_argument(
        "--unpacked",
        action="append",
        default=[],
        help="an absolute directory to name as unpacked; repeatable, or none",
    )
    arguments = parser.parse_args()
    try:
        serve(arguments.socket, arguments.unpacked)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
