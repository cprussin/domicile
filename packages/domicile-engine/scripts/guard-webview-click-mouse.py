#!/usr/bin/env python3
"""Click at one point of the engine's window, from outside it.

guard-webview-click.sh has to press the pointer inside a browser window on a
running desktop. There is no pointer: the guard is headless and
software-composited, for the reason guard-webview-framing.sh is. So the press
is dispatched over the DevTools protocol instead, down the wire in
guard_webview_devtools.py -- which is also where the argument that a press
dispatched this way is hit-tested exactly as the platform's own would be is
written down, and that argument is the whole reason this guard is allowed to
use it.

THE COORDINATES ARE THE SHELL'S WINDOW, in CSS pixels from its top left, which
is what makes them the experiment: the guard picks a point inside the element
and a point outside it, and which widget the press reaches is decided by the
hit test rather than by anything this says.

A PRESS AND A RELEASE, because a click is both and half of one is a state the
desktop is left in. The press is what moves focus -- `OnInputEventPreDispatch`
answers kMouseDown -- so the release changes nothing about what the guard
reads; it is sent so that the window the guard leaves behind is not one with a
button held down in it, which every later reading of that run would be taken
under.
"""

import argparse
import sys

from guard_webview_devtools import command, connect, shell_target

# What a left button looks like in the two ways CDP asks for it: `button` names
# which one the event is about, and `buttons` is the mask of what is held while
# it happens. A press with an empty mask is not a press.
LEFT = "left"
LEFT_HELD = 1
NONE_HELD = 0


def click(connection, x, y):
    """Press and release the left button at (x, y), and answer with both."""
    return [
        command(connection, 1, "Input.dispatchMouseEvent", pressing(x, y)),
        command(connection, 2, "Input.dispatchMouseEvent", releasing(x, y)),
    ]


def pressing(x, y):
    """The left button going down at (x, y)."""
    return mouse_event("mousePressed", x, y, LEFT_HELD)


def releasing(x, y):
    """And coming back up, with nothing held once it has."""
    return mouse_event("mouseReleased", x, y, NONE_HELD)


def mouse_event(kind, x, y, held):
    return {
        "type": kind,
        "x": x,
        "y": y,
        "button": LEFT,
        "buttons": held,
        # A press that is not the first of a click is one the page can tell
        # from a click, and `Input.dispatchMouseEvent` defaults this to 0.
        "clickCount": 1,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument(
        "--x", type=int, required=True, help="CSS pixels from the window's left"
    )
    parser.add_argument(
        "--y", type=int, required=True, help="CSS pixels from the window's top"
    )
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answers = click(connection, arguments.x, arguments.y)
    connection.close()

    for answer in answers:
        if "error" in answer:
            raise SystemExit("the engine refused the click: %s" % answer["error"])
    print("clicked at %d,%d" % (arguments.x, arguments.y), flush=True)


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
