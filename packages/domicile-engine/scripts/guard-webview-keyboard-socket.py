#!/usr/bin/env python3
"""The compositor's end of the control socket, for a guard that has no
compositor.

`ControlChannel` connects to `--domicile-control-socket` and, if nothing is
listening there after thirty seconds, logs, closes the page's end and deletes
itself. A shell is then holding a desktop that throws. Every
outbound leg of this guard runs through that channel -- the claim goes down it
and the press comes back up it -- so the guard needs something on the other end
for the length of the run, and a real compositor is not available here: this
guard is headless and software-composited, with no GPU and no Wayland.

So this accepts the connection, answers `hello` with a keyboard with Tab on
evdev 15 -- the page grabs Alt+Tab by name, and the engine resolves a name
against the keyboard the compositor describes -- and reads. It answers nothing
else: no other message the browser sends on this socket has an answer.

IT IS ALSO THE ASSERTION THAT A CLAIM IS NO LONGER RELAYED. Every line the
browser writes is printed here, so `grab_shortcut` appearing in this log would
mean the claim went to the compositor after all -- and the claims moved into
the browser process precisely because the compositor cannot see a guest's keys
to match one against.
"""

import argparse
import json
import os
import socket
import sys

# The keyboard, as the compositor's `shell_config` describes it: each keysym
# and the evdev key it is on.
KEYBOARD = {"type": "shell_config", "keys": {"Tab": 15}}


def is_hello(line):
    """Whether `line` is the browser's `hello`.

    The real compositor says nothing before it. The browser drops page-bound
    lines that arrive before the page binds its end of the channel.
    """
    return json.loads(line).get("type") == "hello"


def serve(path):
    """Accept connections on `path` and print every line each one sends."""
    if os.path.exists(path):
        os.unlink(path)

    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(4)
    # Before accept, so a guard waiting on this line is not waiting on a
    # buffer.
    print("listening on %s" % path, flush=True)

    while True:
        connection, _ = listener.accept()
        print("a channel connected", flush=True)
        remainder = b""
        with connection:
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                remainder += chunk
                while b"\n" in remainder:
                    line, remainder = remainder.split(b"\n", 1)
                    print("said: %s" % line.decode("utf-8", "replace"), flush=True)
                    if is_hello(line):
                        connection.sendall((json.dumps(KEYBOARD) + "\n").encode("utf-8"))
                        print("sent: %s" % json.dumps(KEYBOARD), flush=True)
        print("the channel went away", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="the path to listen on")
    arguments = parser.parse_args()

    try:
        serve(arguments.socket)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
