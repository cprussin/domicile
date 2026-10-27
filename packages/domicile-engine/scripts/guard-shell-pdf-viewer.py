#!/usr/bin/env python3
"""Reports whether Chrome's PDF viewer started on a PDF the shell shows.

- The viewer is a frame of the PDF extension, a cross-origin child of the
  shell's `<iframe>`, so the shell cannot ask it. It has its own target on the
  debugging port.
- The viewer assigns `window.viewer` once it has its stream info and its zoom,
  which it asks `chrome.tabs` for when the stream has a tab id. A viewer that
  never gets an answer never assigns it, and draws nothing. Checked as an own
  property: `<pdf-viewer id="viewer">` already names `window.viewer` through
  the window's named properties.
- Retries until the viewer has started, or `--tries` runs out.
- Prints `viewer=ready`, `viewer=stuck` (its frame loaded and it never
  started) or `viewer=absent` (the PDF never reached the viewer).
"""

import argparse
import json
import time
import urllib.request

from guard_webview_devtools import command, connect

VIEWER = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/"


def viewer_target(port):
    """The debugging URL of the PDF viewer's frame, or None."""
    listed = "http://127.0.0.1:%d/json/list" % port
    with urllib.request.urlopen(listed, timeout=30) as answer:
        for target in json.load(answer):
            if target.get("url", "").startswith(VIEWER):
                return target["webSocketDebuggerUrl"]
    return None


def started(url, identifier):
    """Whether the viewer at `url` has assigned `window.viewer`."""
    connection = connect(url)
    try:
        answer = command(
            connection,
            identifier,
            "Runtime.evaluate",
            {"expression": "Object.hasOwn(window, 'viewer')", "returnByValue": True},
        )
    finally:
        connection.close()
    return answer.get("result", {}).get("result", {}).get("value") is True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--tries", type=int, default=60)
    args = parser.parse_args()

    seen = False
    for identifier in range(1, args.tries + 1):
        url = viewer_target(args.port)
        if url is not None:
            seen = True
            if started(url, identifier):
                print("viewer=ready")
                return
        time.sleep(0.5)
    print("viewer=stuck" if seen else "viewer=absent")


if __name__ == "__main__":
    main()
