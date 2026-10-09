#!/usr/bin/env python3
"""Drive a pointer and a key at the shell, from outside the engine.

guard-app-routes-input.sh asks whether an `<app>` sends its client what lands
on it. There is no pointer and no keyboard on `crux`, so the input goes in over
the DevTools protocol, down the wire in guard_webview_devtools.py -- where the
argument that a press dispatched this way is hit-tested and routed exactly as
the platform's own is written down.

TRUSTED EVENTS, WHICH IS WHY THIS EXISTS AT ALL. A page could dispatch a
`PointerEvent` at the element itself, and the element would ignore it: an
`<app>` forwards in its default event handling, which Blink runs for trusted
events only. That is the property -- a page cannot click into a client by
script -- and it is why the guard cannot be a page alone.

The sequence, in the shell's CSS pixels:

    move     to 450,150       inside `term`
    press    left at 450,150  and release it
    wheel    100px down at 450,150
    key      a, down and up
    move     to 700,600       off every window
    press    left at 720,520  inside `menu`, and release it
    press    left at 450,150  inside `term`
    move     to 700,600       off every window, still held
    release  left at 700,600
"""

import argparse
import sys

from guard_webview_devtools import command, connect, shell_target

INSIDE_TERM = (450, 150)
OFF_EVERY_WINDOW = (700, 600)
INSIDE_MENU = (720, 520)


def mouse(kind, point, **fields):
    params = {"type": kind, "x": point[0], "y": point[1], "buttons": 0}
    params.update(fields)
    return ("Input.dispatchMouseEvent", params)


def press(point):
    return [
        mouse("mousePressed", point, button="left", buttons=1, clickCount=1),
        mouse("mouseReleased", point, button="left", buttons=0, clickCount=1),
    ]


def key(kind):
    return (
        "Input.dispatchKeyEvent",
        {
            "type": kind,
            "code": "KeyA",
            "key": "a",
            "windowsVirtualKeyCode": 65,
            # evdev 30 + 8: see guard-webview-keyboard-key.py.
            "nativeVirtualKeyCode": 38,
        },
    )


SEQUENCE = (
    [mouse("mouseMoved", INSIDE_TERM)]
    + press(INSIDE_TERM)
    + [mouse("mouseWheel", INSIDE_TERM, deltaX=0, deltaY=100)]
    + [key("rawKeyDown"), key("keyUp")]
    + [mouse("mouseMoved", OFF_EVERY_WINDOW)]
    + [mouse("mouseMoved", INSIDE_MENU)]
    + press(INSIDE_MENU)
    + [mouse("mouseMoved", INSIDE_TERM)]
    + [mouse("mousePressed", INSIDE_TERM, button="left", buttons=1, clickCount=1)]
    + [mouse("mouseMoved", OFF_EVERY_WINDOW, button="left", buttons=1)]
    + [mouse("mouseReleased", OFF_EVERY_WINDOW, button="left", buttons=0, clickCount=1)]
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    for identifier, (method, params) in enumerate(SEQUENCE, start=1):
        answer = command(connection, identifier, method, params)
        if "error" in answer:
            raise SystemExit(
                "the engine refused %s %s: %s" % (method, params["type"], answer["error"])
            )
    connection.close()
    print("drove %d events" % len(SEQUENCE), flush=True)


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
