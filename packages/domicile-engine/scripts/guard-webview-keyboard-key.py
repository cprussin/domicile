#!/usr/bin/env python3
"""Press one key at the engine, from outside it.

guard-webview-keyboard.sh has to drive a keystroke at a running browser while a
browser window holds the keyboard. There is no keyboard: the guard is headless
and software-composited, for the reason guard-webview-framing.sh is -- what it
measures needs no GPU and `crux` has no display. So the key is dispatched over
the DevTools protocol instead.

WHY THAT IS THE REAL PATH AND NOT A SHORTCUT AROUND IT. `Input.dispatchKeyEvent`
on a page target does not send the event to that page. input_handler.cc asks
`widget_host->delegate()->GetFocusedRenderWidgetHost(widget_host)` first and
sends it there -- the same call `RenderWidgetHostViewAura::
ForwardKeyboardEventWithLatencyInfo` makes for a key off a real keyboard, and
the one that decides which widget a keystroke belongs to when a page has more
than one. Over a browser window that is the guest's widget, so the event goes
where the platform would have sent it, through
`RenderWidgetHostImpl::ForwardKeyboardEventWithCommands` and into the focused
WebContents' delegate. Which delegate that turns out to be is the whole
question the guard exists to answer.

`nativeVirtualKeyCode` is required rather than optional, and is not decoration:
the same function marks an event `skip_if_unhandled` when it has no native
keycode, and a skipped event is never offered to a delegate at all. A run that
left it out would report that no chord fired, truthfully and about nothing.

Stdlib only, and that is why there is a WebSocket implementation in here. `crux`
runs this out of a nix shell that has python3 and no wheels, and one text frame
on one connection is not worth a dependency.
"""

import argparse
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.request
from urllib.parse import urlparse

# CDP's modifier bits, which are not blink's. See Input.dispatchKeyEvent.
ALT = 1
CTRL = 2
META = 4
SHIFT = 8


def pick_target(targets):
    """The debugging URL of the shell's own page, out of everything listed.

    Matched on the scheme rather than taken as the first target: a browser
    window is a guest with a page target of its own, and dispatching at *it*
    would skip the focus question this guard is asking -- the event would go
    straight to the guest's widget instead of being routed to whichever widget
    has focus, and a run with the keyboard still in the shell would pass.
    """
    for target in targets:
        if target.get("url", "").startswith("domicile://"):
            return target["webSocketDebuggerUrl"]
    raise SystemExit(
        "no domicile:// target; the engine is showing %s"
        % [target.get("url") for target in targets]
    )


def shell_target(port, tries=40):
    """Ask the engine what it has open, and pick the shell out of it.

    Retried, because the guard gates on a line the *page* printed and the
    debugging port is a different thing coming up: a connection refused here
    would report that the keystroke could not be driven, about a browser that
    was a quarter of a second from being ready.
    """
    listed = "http://127.0.0.1:%d/json/list" % port
    for remaining in range(tries, 0, -1):
        try:
            with urllib.request.urlopen(listed, timeout=30) as answer:
                return pick_target(json.load(answer))
        except OSError:
            if remaining == 1:
                raise
            time.sleep(0.25)
    raise SystemExit("unreachable: the loop above either returns or raises")


def connect(url):
    """A WebSocket on `url`, handshake done."""
    parsed = urlparse(url)
    connection = socket.create_connection(
        (parsed.hostname, parsed.port), timeout=30
    )
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = (
        "GET %s HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Key: %s\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n" % (parsed.path, parsed.hostname, parsed.port, key)
    )
    connection.sendall(request.encode("ascii"))

    headers = b""
    while b"\r\n\r\n" not in headers:
        chunk = connection.recv(4096)
        if not chunk:
            raise SystemExit("the engine closed the connection during the handshake")
        headers += chunk
    if b"101" not in headers.split(b"\r\n", 1)[0]:
        raise SystemExit(
            "the engine refused the WebSocket: %s"
            % headers.split(b"\r\n", 1)[0].decode("ascii", "replace")
        )
    return connection


def send(connection, message):
    """One masked text frame. Every client frame must be masked (RFC 6455)."""
    payload = json.dumps(message).encode("utf-8")
    mask = os.urandom(4)
    header = bytearray([0x81])
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header += struct.pack("!H", length)
    else:
        header.append(0x80 | 127)
        header += struct.pack("!Q", length)
    header += mask
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    connection.sendall(bytes(header) + masked)


def read_exactly(connection, count):
    buffer = b""
    while len(buffer) < count:
        chunk = connection.recv(count - len(buffer))
        if not chunk:
            raise SystemExit("the engine closed the connection mid-frame")
        buffer += chunk
    return buffer


def receive(connection):
    """One server frame, which is never masked and here is never fragmented."""
    header = read_exactly(connection, 2)
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", read_exactly(connection, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", read_exactly(connection, 8))[0]
    return json.loads(read_exactly(connection, length).decode("utf-8"))


def press(connection, identifier, arguments):
    """Send the keystroke and wait for the answer to this command."""
    modifiers = (
        (ALT if arguments.alt else 0)
        | (CTRL if arguments.ctrl else 0)
        | (SHIFT if arguments.shift else 0)
        | (META if arguments.meta else 0)
    )
    send(
        connection,
        {
            "id": identifier,
            "method": "Input.dispatchKeyEvent",
            "params": {
                "type": "rawKeyDown",
                "code": arguments.code,
                "key": arguments.key,
                "windowsVirtualKeyCode": arguments.windows_key_code,
                # evdev + 8 is the XKB keycode, which is what Chromium calls
                # the native one on Linux. Computed here so the guard can name
                # the key in the numbering the desktop's claims use.
                "nativeVirtualKeyCode": arguments.evdev + 8,
                "modifiers": modifiers,
            },
        },
    )
    # Answers can be interleaved with events from domains this session did not
    # enable, so this reads until the one with our id comes back.
    while True:
        answer = receive(connection)
        if answer.get("id") == identifier:
            return answer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--code", required=True, help="a DOM code, e.g. Tab")
    parser.add_argument("--key", required=True, help="a DOM key, e.g. Tab")
    parser.add_argument(
        "--evdev", type=int, required=True, help="the Linux evdev code, e.g. 15"
    )
    parser.add_argument(
        "--windows-key-code", type=int, required=True, help="the VKEY, e.g. 9"
    )
    parser.add_argument("--alt", action="store_true")
    parser.add_argument("--ctrl", action="store_true")
    parser.add_argument("--shift", action="store_true")
    parser.add_argument("--meta", action="store_true")
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answer = press(connection, 1, arguments)
    connection.close()

    if "error" in answer:
        raise SystemExit("the engine refused the keystroke: %s" % answer["error"])
    print("pressed %s (evdev %d)" % (arguments.code, arguments.evdev), flush=True)


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
