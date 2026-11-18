#!/usr/bin/env python3
"""The compositor's end of the control socket, for guard-app-module.sh.

It answers `hello` and `app_hello` with a `welcome`, the browser's `hello`
with the `browser_profiles` it was given as JSON too, if any, and every
`system_request` with a `system_reply`, and prints what it is told:

    said: <line>        every line a page's channel wrote
    app-hello           a connection said `app_hello`

The real compositor decides which calls an app may make
(`domicile_host::system::refused_to_an_app`); this one answers every call, so
the guard measures only what the engine carries. See
docs/architecture/APP-MODULES.md.
"""

import argparse
import json
import os
import socket
import sys
import threading


def say(what):
    print(what, flush=True)


def serve(connection, profiles):
    reader = connection.makefile("r", encoding="utf-8")
    for line in reader:
        line = line.strip()
        if not line:
            continue
        say(f"said: {line}")
        message = json.loads(line)
        kind = message.get("type")
        if kind in ("hello", "app_hello"):
            if kind == "app_hello":
                say("app-hello")
            answer = {"type": "welcome", "protocol_version": 1}
            if kind == "hello" and profiles is not None:
                connection.sendall((json.dumps(answer) + "\n").encode())
                answer = dict({"type": "browser_profiles"}, **profiles)
        elif kind == "system_request":
            answer = {
                "type": "system_reply",
                "id": message["id"],
                "reply": {"kind": "written"},
            }
        else:
            continue
        connection.sendall((json.dumps(answer) + "\n").encode())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--browser-profiles")
    arguments = parser.parse_args()
    path = arguments.socket
    profiles = (
        None
        if arguments.browser_profiles is None
        else json.loads(arguments.browser_profiles)
    )
    if os.path.exists(path):
        os.unlink(path)
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(path)
    listener.listen()
    say(f"listening on {path}")
    while True:
        connection, _ = listener.accept()
        threading.Thread(
            target=serve, args=(connection, profiles), daemon=True
        ).start()


if __name__ == "__main__":
    sys.exit(main())
