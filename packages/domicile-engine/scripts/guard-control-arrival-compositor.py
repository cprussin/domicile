#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that measures the
hop -- and unlike the keyboard guard's stand-in, this one SENDS.

`guard-webview-keyboard-socket.py` accepts a connection and reads, which is all
that guard needs: everything it asserts travels outward from the page. This
guard's question is the other direction. A line written here is read by
`ControlChannel::OnRead` in the browser process, which stamps the moment it had
the bytes, turns it into a mojo message and sends it to the renderer, where
Blink builds an event and dispatches it. That is the stage `arrival` exists to
price, and nothing that does not put a line on this socket exercises it.

THREE LINES, AND THE ORDER IS THE ASSERTION.

    app_cursor  grab        a shape the engine knows
    app_cursor  pointr      one it does not
    app_cursor  zoom-out    a shape it knows, AFTER the one it does not

The middle line is what `components/domicile/common/cursor_shape.h` is for: a
cursor name that is not one of the shapes must not reach the page, because an
unknown CSS keyword is a silent no-op there and the symptom is an arrow where a
hand should be. The third line is why the middle one can be asserted at all --
without it, "the bad cursor was refused" and "the channel died on the bad
cursor" are the same reading, which is a guard that passes when the engine has
stopped working entirely.

ONE LINE PER WRITE, WITH A PAUSE. `arrival` is stamped once per read, not once
per line: a read carrying three messages gives all three the same stamp, which
is correct -- it is one moment -- but it would mean this guard measured one hop
and reported three. Spacing them is what makes each figure its own.

It answers `hello` with a `welcome`, which a real compositor does and which the
browser checks the version of. Every line it receives is printed, so a run where
the page said nothing can be told from one where it said something unexpected.
"""

import argparse
import json
import os
import socket
import sys
import time

# What to send once a channel is up, in order. The names are the wire spelling
# of `domicile_protocol::CursorShape`, which is the same list the engine parses
# with; `pointr` is deliberately not one of them and is deliberately in the
# middle.
SEQUENCE = [
    {"type": "app_cursor", "app_id": "guard", "cursor": "grab"},
    {"type": "app_cursor", "app_id": "guard", "cursor": "pointr"},
    {"type": "app_cursor", "app_id": "guard", "cursor": "zoom-out"},
]

# Long enough that each line lands in its own read on a loaded machine, short
# enough that the guard is not mostly this. Measured against nothing: the
# assertion does not depend on the spacing, only the per-message hop figures do.
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
    # Before accept, so a guard waiting on this line is not waiting on a buffer.
    print("listening on %s" % path, flush=True)

    while True:
        connection, _ = listener.accept()
        print("a channel connected", flush=True)
        with connection:
            # The version the engine speaks; a mismatch is what `welcome`
            # exists to catch and the browser logs it.
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
