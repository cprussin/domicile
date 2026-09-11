"""Driving input at a running engine, over the DevTools protocol.

The guards that put a browser window on a page have to press keys and click in
it, and `crux` has neither a keyboard nor a mouse: it is headless and
software-composited, for the reason guard-webview-framing.sh is -- what these
measure needs no GPU and the machine has no display. So the input is
dispatched over the debugging port instead, and this is the wire it goes down.

WHY THAT IS THE REAL PATH AND NOT A SHORTCUT AROUND IT, for both kinds of
event, and it is the whole reason the guards are allowed to use it:

  a key    `Input.dispatchKeyEvent` on a page target does not send the event to
           that page. input_handler.cc asks `widget_host->delegate()->
           GetFocusedRenderWidgetHost(widget_host)` first and sends it there --
           the same call RenderWidgetHostViewAura makes for a key off a real
           keyboard.
  a press  `Input.dispatchMouseEvent` asks
           `GetRenderWidgetHostAtPointAsynchronously` and sends it to the
           widget under the point -- which is the hit test, the same one the
           platform's own pointer goes through, and over a browser window it
           is what decides whether the press lands in the guest or in the
           chrome around it.

Both of those are the question the guard is asking rather than a step on the
way to it, which is why the dispatch is left to make them.

IMPORTED RATHER THAN COPIED, and the underscores in this file's name are that
and nothing else: a module has to be importable, and `guard-webview-...` is not
a name Python can import. Everything else in this directory is hyphenated
because it is run.

Stdlib only, and that is why there is a WebSocket implementation in here. `crux`
runs these out of a nix shell that has python3 and no wheels, and one text frame
on one connection is not worth a dependency.
"""

import base64
import json
import os
import socket
import struct
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
    would skip the question the guards are asking -- a key would go straight to
    the guest's widget instead of being routed to whichever widget has focus,
    and a press would be hit-tested against the guest's own viewport rather
    than the desktop the shell laid out.
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

    Retried, because a guard gates on a line the *page* printed and the
    debugging port is a different thing coming up: a connection refused here
    would report that the input could not be driven, about a browser that was a
    quarter of a second from being ready.
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


def command(connection, identifier, method, params):
    """Send one command and wait for the answer to this one.

    Answers can be interleaved with events from domains this session did not
    enable, so this reads until the one with our id comes back.
    """
    send(
        connection,
        {"id": identifier, "method": method, "params": params},
    )
    while True:
        answer = receive(connection)
        if answer.get("id") == identifier:
            return answer
