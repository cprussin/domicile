#!/usr/bin/env bash
# What the click driver sends, checked without an engine.
#
# `guard-webview-click-mouse.py` is what puts a press inside a browser window on
# a running desktop, and the two ways it can be silently wrong are both in the
# shape of the events rather than in the transport underneath them (which
# `test-webview-devtools.sh` covers):
#
#   a press with no `buttons` bit set is not a press. Blink takes the button
#     state from that mask, and an event with an empty one is delivered and
#     changes nothing — the guard would then report that a click in the guest
#     was never noticed, truthfully and about a click nobody made
#   a press with no release leaves the desktop with a button held down, which
#     every later reading of that run is taken under
#
# Neither shows up as an error anywhere. The engine accepts both, the guard
# fails, and its sentence is about the layer under test rather than about this.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRIVER="$ROOT/packages/domicile-engine/scripts/guard-webview-click-mouse.py"
[ -f "$DRIVER" ] || {
  echo "no driver at $DRIVER" >&2
  exit 1
}

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which is what the click driver is written in"
  exit 77
}

python3 - "$DRIVER" <<'PYTHON'
import importlib.util
import json
import os
import socket
import struct
import sys

# No .pyc beside it: this runs out of the working tree on every check, and a
# __pycache__ that appears when the suite is run is a dirty tree nobody asked
# for.
sys.dont_write_bytecode = True

# The driver is a script rather than a package — its name has hyphens in it, so
# it cannot be imported by name — and it imports the wire out of its own
# directory, which is why that directory goes on the path first.
sys.path.insert(0, os.path.dirname(sys.argv[1]))
specification = importlib.util.spec_from_file_location("driver", sys.argv[1])
driver = importlib.util.module_from_spec(specification)
specification.loader.exec_module(driver)

failed = 0


def expect(what, want, got):
    global failed
    if want == got:
        print("  ok    %s" % what)
    else:
        print("  FAIL  %s\n    wanted: %r\n    got:    %r" % (what, want, got))
        failed += 1


def server_frame(payload):
    """One unmasked server text frame, by hand."""
    header = bytearray([0x81])
    if len(payload) < 126:
        header.append(len(payload))
    else:
        header.append(126)
        header += struct.pack("!H", len(payload))
    return bytes(header) + payload


def read_client_frame(connection):
    """Decode one frame the way a server does."""
    header = connection.recv(2)
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", connection.recv(2))[0]
    mask = connection.recv(4) if header[1] & 0x80 else b""
    payload = b""
    while len(payload) < length:
        payload += connection.recv(length - len(payload))
    if mask:
        payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
    return json.loads(payload)


print("what a press is")
press = driver.pressing(512, 400)
expect("the left button going down", ("mousePressed", "left"), (press["type"], press["button"]))
# THE ONE THAT IS SILENT WHEN IT IS WRONG. See the header.
expect("with the left button in the held mask", 1, press["buttons"])
expect("as the first press of a click", 1, press["clickCount"])
expect("at the point it was given", (512, 400), (press["x"], press["y"]))

print()
print("and what a release is")
release = driver.releasing(512, 400)
expect(
    "the same button coming up",
    ("mouseReleased", "left"),
    (release["type"], release["button"]),
)
expect("with nothing held once it has", 0, release["buttons"])
expect("at the same point", (512, 400), (release["x"], release["y"]))

print()
print("what a click is, on the wire")
client, server = socket.socketpair()
# Both answers first: `command` sends and then reads until its own id comes
# back, so a click's two commands would otherwise block on a server that is
# this same thread.
for identifier in (1, 2):
    server.sendall(server_frame(json.dumps({"id": identifier, "result": {}}).encode()))
driver.click(client, 512, 400)
sent = [read_client_frame(server), read_client_frame(server)]
expect(
    "a press and then a release, in that order",
    ["mousePressed", "mouseReleased"],
    [message["params"]["type"] for message in sent],
)
expect(
    "both of them mouse events",
    ["Input.dispatchMouseEvent", "Input.dispatchMouseEvent"],
    [message["method"] for message in sent],
)
# Two ids rather than one: an answer is matched by id, so a second command
# reusing the first's would be answered by the reply already read.
expect("each asking under its own id", [1, 2], [message["id"] for message in sent])
client.close()
server.close()

print()
if failed == 0:
    print("the click driver sends a press the engine acts on, and lets go of it")
    sys.exit(0)
print("%d case(s) wrong" % failed, file=sys.stderr)
sys.exit(1)
PYTHON
