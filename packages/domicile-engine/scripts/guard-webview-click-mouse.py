#!/usr/bin/env python3
"""Click at one point of the engine's window over the DevTools protocol.

The guards are headless and software-composited, so there is no real pointer.
guard_webview_devtools.py explains why a press dispatched this way is
hit-tested like a platform one.

Coordinates are CSS pixels from the shell window's top left; the hit test, not
this script, decides which widget the press reaches.

It sends a press and a release. The press moves focus; the release keeps a
held button from affecting later readings. The release carries the same
`button`, because Blink pairs them by button.

The button is an argument: guard-webview-routed-link.sh compares a left press
(follows the link in place) with a middle press (opens a second window).

`--move` moves the pointer there instead, with nothing held, so it hovers.
guard-webview-target-url.sh uses it.
"""

import argparse
import sys

from guard_webview_devtools import command, connect, shell_target

# `button` names the button the event is about; `buttons` is the mask held
# during it (1 primary, 2 secondary, 4 auxiliary). A press needs a non-empty
# mask. Secondary opens a context menu.
BUTTONS = {"left": 1, "middle": 4, "right": 2}
NONE_HELD = 0


def click(connection, x, y, button="left"):
    """Press and release `button` at (x, y), and return both responses."""
    return [
        command(connection, 1, "Input.dispatchMouseEvent", pressing(x, y, button)),
        command(connection, 2, "Input.dispatchMouseEvent", releasing(x, y, button)),
    ]


def move(connection, x, y):
    """Move the pointer to (x, y) with nothing held, and return the response."""
    return command(connection, 1, "Input.dispatchMouseEvent", moving(x, y))


def moving(x, y):
    """Build the event for the pointer arriving at (x, y) with nothing held."""
    # No click count: a move is no part of a click.
    return dict(mouse_event("mouseMoved", x, y, "none", NONE_HELD), clickCount=0)


def pressing(x, y, button="left"):
    """Build the event for `button` going down at (x, y)."""
    return mouse_event("mousePressed", x, y, button, BUTTONS[button])


def releasing(x, y, button="left"):
    """Build the event for `button` going up at (x, y), with nothing held."""
    return mouse_event("mouseReleased", x, y, button, NONE_HELD)


def mouse_event(kind, x, y, button, held):
    return {
        "type": kind,
        "x": x,
        "y": y,
        "button": button,
        "buttons": held,
        # Set clickCount: it defaults to 0, and a page can tell a 0-count press
        # from a click.
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
        help="which button to press; middle asks for a second window, right for a menu",
    )
    parser.add_argument(
        "--move",
        action="store_true",
        help="move the pointer there with nothing held instead of clicking",
    )
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answers = (
        [move(connection, arguments.x, arguments.y)]
        if arguments.move
        else click(connection, arguments.x, arguments.y, arguments.button)
    )
    connection.close()

    for answer in answers:
        if "error" in answer:
            raise SystemExit("the engine refused the event: %s" % answer["error"])
    if arguments.move:
        print("moved the pointer to %d,%d" % (arguments.x, arguments.y), flush=True)
    else:
        print(
            "clicked the %s button at %d,%d"
            % (arguments.button, arguments.x, arguments.y),
            flush=True,
        )


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
