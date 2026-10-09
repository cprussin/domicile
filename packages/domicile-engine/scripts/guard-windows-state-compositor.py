#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that asks whether
`DomicileHost.windows` and `focusedWindow` say what the compositor said.

It answers `hello` with a `welcome`, then describes three windows, retitles,
renames the desktop entry of and resizes one, focuses one, closes one and places
a popup -- and prints every line
the browser writes. The page reads only after all of it, which is the case the
attributes exist for: a shell that listens late misses nothing.

AND THE CURSOR'S CLOSED SET, IN THREE LINES WHOSE ORDER IS THE ASSERTION:

    app_cursor  second  grab        a shape the engine knows
    app_cursor  second  pointr      one it does not
    app_cursor  first   zoom-out    a shape it knows, AFTER the one it does not

`pointr` must not reach the page -- an unknown CSS keyword is a silent no-op
there, and the symptom is an arrow where a hand should be -- so `second` keeps
`grab`. The third line is why the second can be asserted at all: without it,
"the bad cursor was refused" and "the channel died on the bad cursor" are the
same reading. See components/domicile/common/cursor_shape.h.

The config's `appearance` must reach the page's `accentColor`, `highContrast`
and `reducedMotion`.

A `system_reply` ends the sequence: the engine relays it to the page whole, and
the page's `system_request` comes back as a `said:` line. See
docs/SHELL-SYSTEM-ACCESS.md.
"""

import argparse
import json
import os
import socket
import sys
import time

SEQUENCE = [
    {"type": "app_appeared", "app_id": "first", "title": "First"},
    {
        "type": "app_appeared",
        "app_id": "second",
        "title": "Second",
        "desktop_id": "org.example.Second",
        "size": [640, 480],
    },
    {"type": "app_appeared", "app_id": "gone", "title": "Gone"},
    {"type": "app_titled", "app_id": "first", "title": "Retitled"},
    {"type": "app_desktop_id", "app_id": "first", "desktop_id": "org.example.First"},
    {"type": "app_resized", "app_id": "first", "size": [800, 600]},
    {"type": "app_min_size", "app_id": "first", "size": [100, 50]},
    {"type": "app_cursor", "app_id": "second", "cursor": "grab"},
    {"type": "app_cursor", "app_id": "second", "cursor": "pointr"},
    {"type": "app_cursor", "app_id": "first", "cursor": "zoom-out"},
    {"type": "focus_changed", "app_id": "second"},
    {"type": "app_closed", "app_id": "gone"},
    {
        "type": "popup_placed",
        "app_id": "menu",
        "parent": "second",
        "position": [10, 20],
        "size": [120, 90],
        "grab": True,
    },
    {"type": "appearance", "accent_color": "#3584e4", "high_contrast": True, "reduced_motion": False},
    {"type": "system_reply", "id": 1, "reply": {"kind": "written"}},
]


def send(connection, message):
    connection.sendall((json.dumps(message) + "\n").encode("utf-8"))
    print("sent: %s" % json.dumps(message), flush=True)


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
    try:
        serve(parser.parse_args().socket)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
