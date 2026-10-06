#!/usr/bin/env python3
"""Stand-in compositor for guard-control-arrival.sh that sends messages to the
page over the control socket.

It answers with `welcome`, then sends three cursor messages:

    app_cursor  grab        a known shape
    app_cursor  pointr      an unknown shape; the engine must drop it
    app_cursor  zoom-out    a known shape, proving the channel survived

Messages are spaced out because the browser stamps `arrival` once per read,
not per line. Every line received is printed.
"""

import argparse
import json
import os
import socket
import sys
import time

# Wire names from `domicile_protocol::CursorShape`; `pointr` is invalid.
SEQUENCE = [
    {"type": "app_cursor", "app_id": "guard", "cursor": "grab"},
    {"type": "app_cursor", "app_id": "guard", "cursor": "pointr"},
    {"type": "app_cursor", "app_id": "guard", "cursor": "zoom-out"},
]

# Seconds between messages, so each lands in its own read. Not tuned; only the
# per-message hop figures depend on it.
BETWEEN = 0.25


def send(connection, message):
    """Write one newline-delimited JSON message and say so."""
    line = json.dumps(message) + "\n"
    connection.sendall(line.encode("utf-8"))
    print("sent: %s" % line.strip(), flush=True)


def serve(path, sequence):
    """Accept on `path`, answer `hello`, send `sequence`, then read until EOF."""
    if os.path.exists(path):
        os.unlink(path)

    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(4)
    # Printed before accept so the guard sees it while this blocks.
    print("listening on %s" % path, flush=True)

    while True:
        connection, _ = listener.accept()
        print("a channel connected", flush=True)
        with connection:
            # The browser logs a version mismatch.
            send(connection, {"type": "welcome", "protocol_version": 1})
            for message in sequence:
                time.sleep(BETWEEN)
                send(connection, message)
            print("sent the sequence", flush=True)

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
    arguments = parser.parse_args()
    try:
        serve(arguments.socket, SEQUENCE)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
