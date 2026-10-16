#!/usr/bin/env python3
"""Crash the shell's renderer for guard-shell-crash.sh, over the DevTools protocol.

`Page.crash` on the shell's window: its renderer dies as from a bug, so
content reports it crashed. No answer comes, because the renderer that would
send it is gone.
"""

import argparse
import sys

from guard_webview_devtools import connect, send, shell_target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    send(connection, {"id": 1, "method": "Page.crash", "params": {}})
    print("GUARD crashed the shell")
    return 0


if __name__ == "__main__":
    sys.exit(main())
