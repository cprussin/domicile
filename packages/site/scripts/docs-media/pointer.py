"""A virtual pointer that stays on the seat, driven by lines on stdin.

    move <x> <y> <width> <height>   put it at x, y on a width x height layout
    click                           press and release the left button

Each `wlrctl pointer` call adds a pointer to the seat and removes it as it
exits, so the client loses its wl_pointer before a click reaches it. This
one stays for the whole scene.

Usage: pointer.py <generated protocols dir>, after pywayland-scanner wrote
wayland.py and wlr_virtual_pointer_unstable_v1.py there.
"""

import sys
import time

sys.path.insert(0, sys.argv[1])

from pywayland.client import Display  # noqa: E402
from protocols.wayland import WlSeat  # noqa: E402
from protocols.wlr_virtual_pointer_unstable_v1 import (  # noqa: E402
    ZwlrVirtualPointerManagerV1,
)

BTN_LEFT = 0x110

display = Display()
display.connect()
found = {}


def on_global(registry, name, interface, version):
    if interface == "wl_seat":
        found["seat"] = registry.bind(name, WlSeat, 1)
    elif interface == "zwlr_virtual_pointer_manager_v1":
        found["manager"] = registry.bind(name, ZwlrVirtualPointerManagerV1, 1)


registry = display.get_registry()
registry.dispatcher["global"] = on_global
display.roundtrip()
if "manager" not in found:
    sys.exit("the compositor offers no zwlr_virtual_pointer_manager_v1")
pointer = found["manager"].create_virtual_pointer(found.get("seat"))
display.roundtrip()
print("ready", flush=True)


def now():
    return int(time.monotonic() * 1000) & 0xFFFFFFFF


for line in sys.stdin:
    words = line.split()
    if words[:1] == ["move"]:
        x, y, width, height = (int(word) for word in words[1:5])
        pointer.motion_absolute(now(), x, y, width, height)
        pointer.frame()
    elif words[:1] == ["click"]:
        for state in (1, 0):
            pointer.button(now(), BTN_LEFT, state)
            pointer.frame()
            display.flush()
            time.sleep(0.05)
    else:
        print(f"unknown command: {line.strip()}", file=sys.stderr, flush=True)
        continue
    display.roundtrip()
    print("done", flush=True)

pointer.destroy()
display.roundtrip()
display.disconnect()
