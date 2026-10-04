#!/usr/bin/env python3
"""Brings one page the engine shows to the front, over the DevTools protocol.

- `Page.bringToFront` calls `WebContents::Activate()`, as a site's
  `client.focus()` or `window.focus()` does after a notification click.
- `--target guest` fronts the browser window's page (the claim).
- `--target shell` fronts the shell's own page (the control).
- Prints `brought-to-front target=<which>` on success.
"""

import argparse
import json
import sys
import time
import urllib.request

from guard_webview_devtools import command, connect

# Each target's URL prefix: the shell is domicile://, the window's page is the
# guard's http server.
SCHEMES = {"guest": "http://", "shell": "domicile://"}


def target(port, which, tries=40):
    """The debugging URL of `which`, once the engine lists it."""
    listed = "http://127.0.0.1:%d/json/list" % port
    for _ in range(tries):
        with urllib.request.urlopen(listed, timeout=30) as answer:
            for page in json.load(answer):
                if page.get("url", "").startswith(SCHEMES[which]):
                    return page["webSocketDebuggerUrl"]
        time.sleep(0.25)
    raise SystemExit("the engine never listed a %s target" % which)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--target", choices=sorted(SCHEMES), required=True)
    args = parser.parse_args()

    connection = connect(target(args.port, args.target))
    answer = command(connection, 1, "Page.bringToFront", {})
    if "error" in answer:
        raise SystemExit("Page.bringToFront was refused: %s" % answer["error"])
    print("brought-to-front target=%s" % args.target)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
