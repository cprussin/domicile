#!/usr/bin/env python3
"""Press, or with --up release, one key at the engine over the DevTools
protocol.

Used by guard-webview-keyboard.sh and guard-webview-escape.sh, which run
headless with no keyboard. See guard_webview_devtools.py for why this takes the
same path as a real key. guard-webview-escape.sh reads a failed press as "the
browser is gone".

`nativeVirtualKeyCode` is required: without it,
`ForwardKeyboardEventWithCommands` marks the event `skip_if_unhandled`, and a
skipped event never reaches a delegate.
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
            "type": "keyUp" if arguments.up else "rawKeyDown",
            "code": arguments.code,
            "key": arguments.key,
            "windowsVirtualKeyCode": arguments.windows_key_code,
            # Chromium's native keycode on Linux is XKB, which is evdev + 8.
            # Callers pass evdev, the numbering desktop claims use.
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
    parser.add_argument("--up", action="store_true", help="release the key")
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answer = press(connection, 1, arguments)
    connection.close()

    if "error" in answer:
        raise SystemExit("the engine refused the keystroke: %s" % answer["error"])
    print(
        "%s %s (evdev %d)"
        % ("released" if arguments.up else "pressed", arguments.code, arguments.evdev),
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
