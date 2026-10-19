#!/usr/bin/env python3
"""Crash the shell's renderer for guard-shell-crash.sh, over the DevTools protocol.

`Page.crash` on the shell's window: its renderer dies as from a bug, so
content reports it crashed. No answer comes, because the renderer that would
send it is gone.

The session stays open until the crash is seen. Closing it right after the send
detaches the session, and the command can be dropped before it reaches the
renderer.
"""

import argparse
import json
import sys
import time

from guard_webview_devtools import (
    Closed,
    command,
    connect,
    receive,
    send,
    shell_target,
)

# How long to wait for the crash after sending `Page.crash`.
WAIT_SECONDS = 30
CRASH_ID = 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    arguments = parser.parse_args()

    connection = connect(shell_target(arguments.port))
    command(connection, 1, "Inspector.enable", {})
    send(connection, {"id": CRASH_ID, "method": "Page.crash", "params": {}})
    print("GUARD sent Page.crash", flush=True)
    return 0 if crash_landed(connection) else 1


def crash_landed(connection):
    """Whether the renderer died within WAIT_SECONDS, printing each frame seen.

    Either `Inspector.targetCrashed` arrives, or the engine hangs up because
    DieIfTheShellDied (patch 0124) took it down first.
    """
    deadline = time.monotonic() + WAIT_SECONDS
    try:
        while True:
            connection.settimeout(max(deadline - time.monotonic(), 0.01))
            message = receive(connection)
            print("GUARD saw %s" % json.dumps(message), flush=True)
            if message.get("method") == "Inspector.targetCrashed":
                print("GUARD crashed the shell")
                return True
            if message.get("id") == CRASH_ID and "error" in message:
                print("GUARD the engine refused Page.crash")
                return False
    except TimeoutError:
        print("GUARD no crash within %d seconds" % WAIT_SECONDS)
        return False
    except (Closed, OSError) as error:
        print("GUARD crashed the shell; the engine hung up: %s" % error)
        return True


if __name__ == "__main__":
    sys.exit(main())
