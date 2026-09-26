#!/usr/bin/env python3
"""Reload the shell over the debugging port: guard-shell-shortcuts.sh's control.

The browser reloading the page, rather than a key asking it to, so the guard
can show it would have read a reload had one of its keys caused one.
"""

import argparse
import sys

from guard_webview_devtools import command, connect, shell_target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    answer = command(connection, 1, "Page.reload", {})
    connection.close()

    if "error" in answer:
        raise SystemExit("the engine refused the reload: %s" % answer["error"])
    print("reloaded the shell", flush=True)


if __name__ == "__main__":
    try:
        main()
    except OSError as failure:
        sys.exit("could not reach the engine's debugging port: %s" % failure)
