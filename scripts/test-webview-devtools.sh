#!/usr/bin/env bash
# The input drivers' wire, checked without an engine.
#
# `guard_webview_devtools.py` carries a WebSocket client, because `crux` runs
# these out of a nix shell with python3 and no wheels and one text frame on one
# connection is not worth a dependency. That client is the one piece of the
# guards that use it which is neither exercised by anything else nor visible
# when it is wrong: a frame it encodes badly is a connection Chromium closes,
# the guard reports that nothing fired, and the reading is about the harness
# while the sentence is about the layer under test. Each of those costs a run on
# the shared tree.
#
# So the framing is asserted here, in the check suite that runs on every commit:
# what `send` writes is decoded back by an independent reader, and what
# `receive` reads is written by hand. Both directions, because they are
# different halves of RFC 6455 — a client frame MUST be masked and a server
# frame MUST NOT be, and getting that backwards is the classic way to write a
# WebSocket client that never works.
#
# `pick_target` is here for a different reason. It decides which page the input
# is dispatched at, and the wrong answer is not an error: a browser window is a
# page target of its own, and dispatching at *it* would deliver a key straight
# to the guest with the shell still holding the keyboard, and hit-test a press
# against the guest's own viewport rather than the desktop the shell laid out.
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

# No .pyc beside it: this runs out of the working tree on every check, and a
# __pycache__ that appears when the suite is run is a dirty tree nobody asked
# for.
sys.dont_write_bytecode = True

# The drivers find this module the same way, by being run out of the directory
# it is in.
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
# The one a server enforces: RFC 6455 says a client frame that is not masked
# must be rejected, and Chromium's does reject it.
expect("masked, as every client frame must be", True, frame["masked"])
expect(
    "carrying the command",
    {"id": 1, "method": "Input.dispatchKeyEvent"},
    json.loads(frame["payload"]),
)

# The extended-length branch, which a short command never reaches and a real
# Input.dispatchKeyEvent with commands would.
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
