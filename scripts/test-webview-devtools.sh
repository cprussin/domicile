#!/usr/bin/env bash
# Tests the input drivers' WebSocket client, without an engine.
#
# `guard_webview_devtools.py` has its own WebSocket client because `crux` runs
# the guards with python3 and no extra packages. A badly framed message makes
# Chromium close the connection, and the guard then blames the wrong layer.
#
# Both directions are checked: `send` is decoded by an independent reader, and
# `receive` reads hand-written frames. RFC 6455 requires client frames to be
# masked and server frames not to be.
#
# `pick_target` must choose the shell page. A browser window is its own page
# target; dispatching there would bypass the shell's keyboard focus and
# hit-test against the guest's viewport.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIRE="$ROOT/packages/domicile-engine/scripts/guard_webview_devtools.py"
[ -f "$WIRE" ] || {
  echo "no wire at $WIRE" >&2
  exit 1
}

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which is what the input drivers are written in"
  exit 77
}

python3 - "$(dirname "$WIRE")" <<'PYTHON'
import json
import socket
import struct
import sys

# Keep the working tree clean of __pycache__.
sys.dont_write_bytecode = True

# The drivers import this module from their own directory too.
sys.path.insert(0, sys.argv[1])
import guard_webview_devtools as driver

failed = 0


def expect(what, want, got):
    global failed
    if want == got:
        print("  ok    %s" % what)
    else:
        print("  FAIL  %s\n    wanted: %r\n    got:    %r" % (what, want, got))
        failed += 1


def read_client_frame(connection):
    """Decode one frame the way a server does, independently of `send`."""
    header = connection.recv(2)
    final_and_opcode, masked_and_length = header[0], header[1]
    length = masked_and_length & 0x7F
    if length == 126:
        length = struct.unpack("!H", connection.recv(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", connection.recv(8))[0]
    mask = connection.recv(4) if masked_and_length & 0x80 else b""
    payload = b""
    while len(payload) < length:
        payload += connection.recv(length - len(payload))
    if mask:
        payload = bytes(
            byte ^ mask[index % 4] for index, byte in enumerate(payload)
        )
    return {
        "fin": bool(final_and_opcode & 0x80),
        "opcode": final_and_opcode & 0x0F,
        "masked": bool(masked_and_length & 0x80),
        "payload": payload,
    }


def server_frame(payload):
    """One unmasked server text frame, by hand."""
    header = bytearray([0x81])
    if len(payload) < 126:
        header.append(len(payload))
    else:
        header.append(126)
        header += struct.pack("!H", len(payload))
    return bytes(header) + payload


print("what the wire writes")
client, server = socket.socketpair()
driver.send(client, {"id": 1, "method": "Input.dispatchKeyEvent"})
frame = read_client_frame(server)
expect("a final text frame", (True, 1), (frame["fin"], frame["opcode"]))
# RFC 6455 requires a server to reject an unmasked client frame, and Chromium
# does.
expect("masked, as every client frame must be", True, frame["masked"])
expect(
    "carrying the command",
    {"id": 1, "method": "Input.dispatchKeyEvent"},
    json.loads(frame["payload"]),
)

# Covers the extended-length branch, which a real command can reach.
long_message = {"id": 2, "method": "x" * 400}
driver.send(client, long_message)
frame = read_client_frame(server)
expect("a payload over 125 bytes survives", long_message, json.loads(frame["payload"]))

print()
print("what the wire reads")
server.sendall(server_frame(json.dumps({"id": 7, "result": {}}).encode("utf-8")))
expect("a short server frame", {"id": 7, "result": {}}, driver.receive(client))
padded = {"id": 8, "result": {"note": "y" * 400}}
server.sendall(server_frame(json.dumps(padded).encode("utf-8")))
expect("a server frame over 125 bytes", padded, driver.receive(client))

print()
print("which page the input is dispatched at")
expect(
    "the shell, not the browser window in it",
    "ws://shell",
    driver.pick_target(
        [
            {"url": "http://127.0.0.1:8732/page", "webSocketDebuggerUrl": "ws://guest"},
            {"url": "domicile://shell/?kind=webview", "webSocketDebuggerUrl": "ws://shell"},
        ]
    ),
)
try:
    driver.pick_target([{"url": "about:blank", "webSocketDebuggerUrl": "ws://nothing"}])
    expect("no shell is refused rather than guessed", "refused", "picked one anyway")
except SystemExit:
    expect("no shell is refused rather than guessed", "refused", "refused")

client.close()
server.close()

print()
if failed == 0:
    print("the drivers' frames are the ones Chromium accepts")
    sys.exit(0)
print("%d case(s) wrong" % failed, file=sys.stderr)
sys.exit(1)
PYTHON
