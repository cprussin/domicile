#!/usr/bin/env python3
"""Serves the page guard-webview-notifications.sh loads.

`/asks?permission=<name>` asks the Permissions API about `<name>`. It paints
the guard's color if the answer is "prompt", and white otherwise. `none`
paints the color without asking, so the control can show the probe sees it.
"""

import argparse
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

ASKS = "/asks"

# The answer is painted, so the probe needs no channel out of the guest.
# `navigator.permissions.query` reads the same content setting that
# Notification.requestPermission() would.
PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>a page asking what it may do</title>
    <style>
      html,
      body {{
        background: #ffffff;
        block-size: 100%;
        inline-size: 100%;
        margin: 0;
        padding: 0;
      }}
    </style>
  </head>
  <body>
    <script>
      const paint = () => {{
        document.body.style.background = "#{color}";
      }};
      const permission = {permission};
      if (permission === "none") {{
        paint();
      }} else {{
        navigator.permissions.query({{ name: permission }}).then((status) => {{
          if (status.state === "prompt") {{
            paint();
          }}
        }});
      }}
    </script>
  </body>
</html>
"""

# The names this page asks about. Anything else is a harness bug.
PERMISSIONS = {"none", "notifications", "geolocation"}


class Asks(BaseHTTPRequestHandler):
    """Answers ASKS, and everything else with a 404."""

    # Set by main(): BaseHTTPRequestHandler is instantiated per request.
    color = "000000"

    def do_GET(self):  # noqa: N802 - the name is BaseHTTPRequestHandler's
        split = urlsplit(self.path)
        asked = parse_qs(split.query).get("permission", [])
        if split.path != ASKS:
            self.send_error(404, "this server has one page and that is not it")
        elif len(asked) != 1 or asked[0] not in PERMISSIONS:
            self.send_error(400, "%s takes one ?permission= of %s" % (ASKS, sorted(PERMISSIONS)))
        else:
            body = PAGE.format(color=self.color, permission='"%s"' % asked[0]).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        # To stderr, which the guard keeps: whether the page was ever asked for
        # tells "the guest never loaded" from "it loaded and was refused".
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True,
                        help="0 for any free one; the serving line names it")
    parser.add_argument("--color", required=True,
                        help="RRGGBB, no leading #; what a page that must ask paints")
    arguments = parser.parse_args()

    Asks.color = arguments.color
    # 127.0.0.1 makes the page a secure context, which the Permissions API
    # requires for notifications.
    server = ThreadingHTTPServer(("127.0.0.1", arguments.port), Asks)
    print("serving %s on 127.0.0.1:%d" % (ASKS, server.server_address[1]), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
