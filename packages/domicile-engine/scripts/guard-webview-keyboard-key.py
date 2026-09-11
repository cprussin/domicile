#!/usr/bin/env python3
"""Press one key at the engine, from outside it.

guard-webview-keyboard.sh has to drive a keystroke at a running browser while a
browser window holds the keyboard. There is no keyboard: the guard is headless
and software-composited, for the reason guard-webview-framing.sh is -- what it
measures needs no GPU and `crux` has no display. So the key is dispatched over
the DevTools protocol instead, down the wire in guard_webview_devtools.py,
which is also where the argument that this is the real path a key takes rather
than a way around it is written down.

`nativeVirtualKeyCode` is required rather than optional, and is not decoration:
`ForwardKeyboardEventWithCommands` marks an event `skip_if_unhandled` when it
has no native keycode, and a skipped event is never offered to a delegate at
all. A run that left it out would report that no chord fired, truthfully and
about nothing.
"""

import argparse
import sys

from guard_webview_devtools import (
    ALT,
    CTRL,
    META,
    SHIFT,
    command,
    connect,
    shell_target,
)


def press(connection, identifier, arguments):
    """Send the keystroke and wait for the answer to this command."""
    modifiers = (
        (ALT if arguments.alt else 0)
        | (CTRL if arguments.ctrl else 0)
        | (SHIFT if arguments.shift else 0)
        | (META if arguments.meta else 0)
    )
    return command(
        connection,
        identifier,
        "Input.dispatchKeyEvent",
        {
            "type": "rawKeyDown",
            "code": arguments.code,
            "key": arguments.key,
            "windowsVirtualKeyCode": arguments.windows_key_code,
            # evdev + 8 is the XKB keycode, which is what Chromium calls the
            # native one on Linux. Computed here so the guard can name the key
            # in the numbering the desktop's claims use.
            "nativeVirtualKeyCode": arguments.evdev + 8,
            "modifiers": modifiers,
        },
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--code", required=True, help="a DOM code, e.g. Tab")
    parser.add_argument("--key", required=True, help="a DOM key, e.g. Tab")
    parser.add_argument(
        "--evdev", type=int, required=True, help="the Linux evdev code, e.g. 15"
    )
    parser.add_argument(
        "--windows-key-code", type=int, required=True, help="the VKEY, e.g. 9"
    )
    parser.add_argument("--alt", action="store_true")
    parser.add_argument("--ctrl", action="store_true")
    parser.add_argument("--shift", action="store_true")
    parser.add_argument("--meta", action="store_true")
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answer = press(connection, 1, arguments)
    connection.close()

    if "error" in answer:
        raise SystemExit("the engine refused the keystroke: %s" % answer["error"])
    print("pressed %s (evdev %d)" % (arguments.code, arguments.evdev), flush=True)


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
