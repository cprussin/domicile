#!/usr/bin/env python3
"""Right-clicks in DevTools' front end and reports whether it drew its own menu.

- The engine draws no native menus, so DevTools must use its HTML soft menu
  (`.soft-context-menu`, in a shadow root).
- The press is dispatched at the front end's own target: the question is which
  menu DevTools shows, not where the shell routes a press.
- Clicks a row of the Elements tree. DevTools draws no menu where it has no
  items, such as an empty area.
- Retries until the front end has loaded and drawn a menu, or `--tries` runs
  out.
- Prints `soft-menu` when the menu is drawn, `no-soft-menu` otherwise.
"""

import argparse
import json
import sys
import time
import urllib.request

from guard_webview_devtools import command, connect

FRONTEND = "devtools://devtools/bundled/devtools_app.html"

# CDP's mask for the secondary button. See guard-webview-click-mouse.py.
RIGHT_HELD = 2
# The release lands up and left of the press. The menu opens down and right of
# it, and a release on an item would run that item.
OFF_MENU = 10

# Every element under the document, through shadow roots.
EVERY_ELEMENT = """
const every = (root) => [...root.querySelectorAll('*')].flatMap(
  (element) => element.shadowRoot === null
    ? [element] : [element, ...every(element.shadowRoot)]);
"""

# Whether a soft menu is drawn.
FIND_SOFT_MENU = (
    "(() => {%s return every(document).some("
    "(element) => element.classList.contains('soft-context-menu')); })()"
    % EVERY_ELEMENT
)

# The middle of the shortest tree row on screen, as [x, y], or null. The
# Elements panel opens on the inspected node, and a row is one node, whose
# menu has items. The shortest row is one line, so its middle is on it.
FIND_TREE_NODE = (
    "(() => {%s const rows = every(document).filter((element) => {"
    " const box = element.getBoundingClientRect();"
    " return element.matches('li[role=treeitem]')"
    " && box.width > 0 && box.height > 0; });"
    " if (rows.length === 0) { return null; }"
    " const box = rows.map((row) => row.getBoundingClientRect())"
    " .reduce((a, b) => (b.height < a.height ? b : a));"
    " return [Math.round(box.left + box.width / 2),"
    " Math.round(box.top + box.height / 2)]; })()" % EVERY_ELEMENT
)


def frontend_target(port, tries):
    """The debugging URL of DevTools' front end, once the engine lists it."""
    listed = "http://127.0.0.1:%d/json/list" % port
    for _ in range(tries):
        with urllib.request.urlopen(listed, timeout=30) as answer:
            for page in json.load(answer):
                if page.get("url", "").startswith(FRONTEND):
                    return page["webSocketDebuggerUrl"]
        time.sleep(0.5)
    raise SystemExit("the engine never listed DevTools' front end")


def evaluate(connection, identifier, expression):
    """The value of `expression` in the front end, or None."""
    answer = command(
        connection,
        identifier,
        "Runtime.evaluate",
        {"expression": expression, "returnByValue": True},
    )
    return answer.get("result", {}).get("result", {}).get("value")


def right_click(connection, identifier, x, y):
    """Press the right button at (x, y) and release it off the menu."""
    command(
        connection,
        identifier,
        "Input.dispatchMouseEvent",
        right_button("mousePressed", x, y, RIGHT_HELD),
    )
    command(
        connection,
        identifier + 1,
        "Input.dispatchMouseEvent",
        right_button("mouseReleased", x - OFF_MENU, y - OFF_MENU, 0),
    )


def right_button(kind, x, y, held):
    return {
        "type": kind,
        "x": x,
        "y": y,
        "button": "right",
        "buttons": held,
        "clickCount": 1,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--tries", type=int, default=30)
    args = parser.parse_args()

    connection = connect(frontend_target(args.port, args.tries))
    identifier = 0
    for _ in range(args.tries):
        identifier += 4
        node = evaluate(connection, identifier, FIND_TREE_NODE)
        if node is not None:
            right_click(connection, identifier + 1, node[0], node[1])
            time.sleep(1)
            if evaluate(connection, identifier + 3, FIND_SOFT_MENU) is True:
                print("soft-menu at %d,%d" % (node[0], node[1]))
                sys.stdout.flush()
                return
        else:
            time.sleep(1)
    print("no-soft-menu")
    sys.stdout.flush()


if __name__ == "__main__":
    main()
