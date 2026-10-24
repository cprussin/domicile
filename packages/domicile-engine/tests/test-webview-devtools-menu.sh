#!/usr/bin/env bash
# Tests the right click `guard-webview-devtools-menu.py` sends, without an
# engine.
#
#   - The press must hold the secondary button, or Blink fires no contextmenu.
#   - The release must land off the menu, which opens down and right of the
#     press. A release on an item runs that item.
#
# The transport is covered by `test-webview-devtools.sh`.
set -u

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DRIVER="$ROOT/packages/domicile-engine/scripts/guard-webview-devtools-menu.py"
[ -f "$DRIVER" ] || {
  echo "no driver at $DRIVER" >&2
  exit 1
}

command -v python3 >/dev/null || {
  echo "SKIP: no python3, which is what the DevTools menu driver is written in"
  exit 77
}

python3 - "$DRIVER" <<'PYTHON'
import importlib.util
import json
import os
import socket
import struct
import sys

sys.dont_write_bytecode = True

# The driver's name has hyphens, so load it by path, with its directory on the
# path for the wire module.
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
    return bytes([0x81, len(payload)]) + payload


def read_client_frame(connection):
    header = connection.recv(2)
    length = header[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", connection.recv(2))[0]
    mask = connection.recv(4)
    payload = b""
    while len(payload) < length:
        payload += connection.recv(length - len(payload))
    return json.loads(bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload)))


client, server = socket.socketpair()
for identifier in (7, 8):
    server.sendall(server_frame(json.dumps({"id": identifier, "result": {}}).encode()))
driver.right_click(client, 7, 512, 384)
press, release = [read_client_frame(server) for _ in range(2)]
client.close()
server.close()

print("the press")
expect("is a mouse event", "Input.dispatchMouseEvent", press["method"])
expect(
    "is the right button going down",
    ("mousePressed", "right"),
    (press["params"]["type"], press["params"]["button"]),
)
expect("holds the secondary button", 2, press["params"]["buttons"])
expect("is at the point given", (512, 384), (press["params"]["x"], press["params"]["y"]))

print()
print("the release")
expect(
    "is the right button coming up",
    ("mouseReleased", "right"),
    (release["params"]["type"], release["params"]["button"]),
)
expect("holds nothing", 0, release["params"]["buttons"])
expect(
    "is up and left of the press, off the menu",
    True,
    release["params"]["x"] < 512 and release["params"]["y"] < 384,
)
expect("asks under the next id", (7, 8), (press["id"], release["id"]))

print()
if failed == 0:
    print("the DevTools menu driver opens a menu and lets go off it")
    sys.exit(0)
print("%d case(s) wrong" % failed, file=sys.stderr)
sys.exit(1)
PYTHON
