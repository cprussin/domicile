#!/usr/bin/env python3
"""The compositor's end of the control socket, for the guard that drives an
agent seat's pointer and keys into a browser window at desk positions.

It answers `hello` with a `welcome`. Then it takes the guard's events on
`--drive`, one JSON line each:

  {"seat": "agent-1", "input": {"kind": "pointer", "x": 40, "y": 104}}

and sends each to the browser as the compositor does, an `agent_input` with
the next serial. A quiet one (`"quiet": true`, or a release) is answered
`{"sent": true}`; any other is answered with the browser's
`agent_input_reached` for its serial. Prints every line either way.
"""

import argparse
import json
import os
import queue
import socket
import sys
import threading
import time

# Serials grow from the clock, as the compositor's do.
SERIAL = [int(time.time() * 1_000_000)]

# The browser's answers, by serial.
REACHED = {}
REACHED_LOCK = threading.Condition()

# The browser's channel, once it said hello.
CHANNEL = queue.Queue(maxsize=1)


def send(connection, message):
    connection.sendall((json.dumps(message) + "\n").encode("utf-8"))
    print("sent: %s" % json.dumps(message), flush=True)


def serve_browser(path):
    if os.path.exists(path):
        os.unlink(path)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(4)
    print("listening on %s" % path, flush=True)
    while True:
        connection, _ = listener.accept()
        print("a channel connected", flush=True)
        threading.Thread(target=hear_browser, args=(connection,), daemon=True).start()


def hear_browser(connection):
    remainder = b""
    while True:
        chunk = connection.recv(65536)
        if not chunk:
            print("the channel went away", flush=True)
            return
        remainder += chunk
        while b"\n" in remainder:
            line, remainder = remainder.split(b"\n", 1)
            text = line.decode("utf-8", "replace")
            print("said: %s" % text, flush=True)
            said = json.loads(line)
            if said.get("type") == "hello":
                send(connection, {"type": "welcome", "protocol_version": 1})
                try:
                    CHANNEL.put_nowait(connection)
                except queue.Full:
                    pass
            elif said.get("type") == "agent_input_reached":
                with REACHED_LOCK:
                    REACHED[int(said["serial"])] = said
                    REACHED_LOCK.notify_all()


def serve_guard(path):
    if os.path.exists(path):
        os.unlink(path)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    listener.listen(4)
    print("driving on %s" % path, flush=True)
    browser = None
    while True:
        guard, _ = listener.accept()
        with guard:
            ask = json.loads(guard.makefile().readline())
            if browser is None:
                browser = CHANNEL.get(timeout=60)
            SERIAL[0] += 1
            serial = SERIAL[0]
            quiet = ask.get("quiet", False) or ask["input"].get("pressed") is False
            message = {
                "type": "agent_input",
                "serial": serial,
                "seat": ask["seat"],
                "input": ask["input"],
            }
            if ask.get("barred"):
                message["barred"] = ask["barred"]
            if quiet:
                message["quiet"] = True
            send(browser, message)
            if quiet:
                answer = {"sent": True}
            else:
                with REACHED_LOCK:
                    REACHED_LOCK.wait_for(
                        lambda asked=serial: asked in REACHED, timeout=15
                    )
                    answer = REACHED.get(serial, {"never": "answered"})
            guard.sendall(
                (json.dumps(answer, separators=(",", ":")) + "\n").encode("utf-8")
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--socket", required=True, help="the control socket to bind")
    parser.add_argument(
        "--drive", help="the guard's socket to bind; none only answers hello"
    )
    arguments = parser.parse_args()
    try:
        if arguments.drive is None:
            serve_browser(arguments.socket)
        threading.Thread(
            target=serve_browser, args=(arguments.socket,), daemon=True
        ).start()
        serve_guard(arguments.drive)
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
