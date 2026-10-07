#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that asks whether
portal requests reach a shell that listens late, and its answers come back.

It answers `hello` with a `welcome`, then sends one `portal_requests` line
with one access request, and then `idle`, which tells the page the requests have reached it. It prints
every line the browser writes, and each `answer_portal_request` as
`answered: <id> <answer>`.
"""

import argparse
import json
import os
import socket
import sys


def requests():
    return {
        "type": "portal_requests",
        "items": [{
            "id": 1,
            "app_id": "org.example.App",
            "kind": "access",
            "body": {"title": "Use the camera?", "subtitle": "", "body": "",
                     "grant_label": "Allow", "deny_label": "Deny"},
        }],
    }


def send(connection, message):
    connection.sendall((json.dumps(message) + "\n").encode("utf-8"))
    print("sent: %s" % json.dumps(message), flush=True)


def heard(line):
    print("said: %s" % line.decode("utf-8", "replace"), flush=True)
    try:
        message = json.loads(line)
    except ValueError:
        return
    if message.get("type") == "answer_portal_request":
        print("answered: %s %s" % (message.get("id"),
                                   json.dumps(message.get("answer"),
                                              sort_keys=True)), flush=True)


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
            send(connection, requests())
            send(connection, {"type": "idle", "idle": True})
            remainder = b""
            while True:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                remainder += chunk
                while b"\n" in remainder:
                    line, remainder = remainder.split(b"\n", 1)
                    heard(line)
        print("the channel went away", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="path to bind")
    arguments = parser.parse_args()
    try:
        serve(arguments.socket)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
