#!/usr/bin/env python3
"""The compositor's end of the control socket for guard-webview-hidden-theme.sh.

It answers `hello` with a `welcome` and a light theme. When the file named by
`--turn` appears, it turns the desk dark: `theme` for the shell, then
`windows_theme` for the windows' pages, as the compositor does once the
chromes have captured their old frames. It prints `turned` after. Without
`--turn` the desk stays light.
"""

import argparse
import json
import os
import socket
import sys
import threading
import time


def send(connection, message):
    connection.sendall((json.dumps(message) + "\n").encode("utf-8"))
    print("sent: %s" % json.dumps(message), flush=True)


def turn_when_asked(connection, trigger):
    while not os.path.exists(trigger):
        time.sleep(0.05)
    send(connection, {"type": "theme", "theme": "dark"})
    send(connection, {"type": "windows_theme", "theme": "dark"})
    print("turned", flush=True)


def greet(connection, trigger):
    send(connection, {"type": "welcome", "protocol_version": 1})
    send(connection, {"type": "theme", "theme": "light"})
    send(connection, {"type": "windows_theme", "theme": "light"})
    if trigger is not None:
        threading.Thread(target=turn_when_asked, args=(connection, trigger), daemon=True).start()


def is_hello(line):
    """Whether `line` is the browser's `hello`.

    The real compositor says nothing before it. The browser drops page-bound
    lines that arrive before the page binds its end of the channel.
    """
    return json.loads(line).get("type") == "hello"


def serve(path, trigger):
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
                    if is_hello(line):
                        greet(connection, trigger)
        print("the channel went away", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="path to bind")
    parser.add_argument("--turn", help="file whose creation turns the desk dark")
    arguments = parser.parse_args()
    try:
        serve(arguments.socket, arguments.turn)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
