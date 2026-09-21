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

WHICH BUTTON IS AN ARGUMENT, AND FOR ONE GUARD IT IS THE EXPERIMENT. A left
press on a link follows it in place; a MIDDLE press on the same link asks for
it in a second window, and that difference is decided in the browser process
rather than in the page. guard-webview-routed-link.sh drives both at one point
on one link, so the only thing that differs between its run and its control is
this flag -- which is why the button is named here rather than assumed.

The release carries the same `button` as the press. A middle press answered by
a left release is not a click anybody makes, and Blink pairs them by button.
"""

import argparse
import sys

from guard_webview_devtools import command, connect, shell_target

# What a button looks like in the two ways CDP asks for it: `button` names which
# one the event is about, and `buttons` is the mask of what is held while it
# happens. The two are not the same spelling of one fact -- the mask is a
# bitfield in the DOM's own order, where 1 is primary and 4 is auxiliary (2 is
# the secondary button, which nothing here sends) -- and a press with an empty
# mask is not a press.
BUTTONS = {"left": 1, "middle": 4}
NONE_HELD = 0


def click(connection, x, y, button="left"):
    """Press and release `button` at (x, y), and answer with both."""
    return [
        command(connection, 1, "Input.dispatchMouseEvent", pressing(x, y, button)),
        command(connection, 2, "Input.dispatchMouseEvent", releasing(x, y, button)),
    ]


def pressing(x, y, button="left"):
    """The button going down at (x, y), and held while it does."""
    return mouse_event("mousePressed", x, y, button, BUTTONS[button])


def releasing(x, y, button="left"):
    """And coming back up, with nothing held once it has."""
    return mouse_event("mouseReleased", x, y, button, NONE_HELD)


def mouse_event(kind, x, y, button, held):
    return {
        "type": kind,
        "x": x,
        "y": y,
        "button": button,
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
    parser.add_argument(
        "--button",
        choices=sorted(BUTTONS),
        default="left",
        help="which button to press; middle is what asks for a second window",
    )
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answers = click(connection, arguments.x, arguments.y, arguments.button)
    connection.close()

    for answer in answers:
        if "error" in answer:
            raise SystemExit("the engine refused the click: %s" % answer["error"])
    print(
        "clicked the %s button at %d,%d" % (arguments.button, arguments.x, arguments.y),
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
